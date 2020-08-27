import tls from 'tls';
import os from 'os';
import winston from 'winston';
import { LEVEL, MESSAGE } from 'triple-beam';
import { Produce } from 'glossy';
import Transport from 'winston-transport';
import { EventEmitter } from 'events';
import * as net from 'net';
import { Socket } from 'net';

const KEEPALIVE_INTERVAL = 15 * 1000;

/**
 * Heavily inspired by
 * https://github.com/winstonjs/winston-syslog/blob/master/lib/winston-syslog.js
 * https://github.com/kenperkins/winston-papertrail/blob/v2/test/papertrail-test.js
 * */

export interface PapertrailTransportOptions extends Transport.TransportStreamOptions {
  host: string;
  port: number;
  disableTls?: boolean;
  hostname?: string;
  program?: string;
  facility?: string;
  levels?: any;
  flushOnClose?: boolean;
  // options for connection failure and retry behavior
  attemptsBeforeDecay?: number;
  maximumAttempts?: number;
  connectionDelay?: number;
  maxDelayBetweenReconnection?: number;
}

if (Number(winston.version.split('.')[0]) < 3) {
  throw new Error('winston-papertrail-transport requires winston >= 3.0.0');
}

export class PapertrailTransport extends Transport {
  private options: PapertrailTransportOptions;
  public connection: PapertrailConnection;
  private producer: any;

  get name() {
    return 'papertrail';
  }

  constructor(options: PapertrailTransportOptions) {
    super(options);

    const defaultOptions: PapertrailTransportOptions = {
      host: 'localhost',
      port: 417,
      program: 'default',
      facility: 'daemon',
      hostname: os.hostname(),
      levels: {
        debug: 7,
        info: 6,
        notice: 5,
        warning: 4,
        warn: 4,
        error: 3,
        err: 3,
        crit: 2,
        alert: 1,
        emerg: 0,
      },
      attemptsBeforeDecay: 5,
      maximumAttempts: 25,
      connectionDelay: 1000,
      handleExceptions: false,
      maxDelayBetweenReconnection: 60000,
      flushOnClose: true,
      disableTls: false,
    };

    this.options = Object.assign({}, defaultOptions, options);
    this.connection = new PapertrailConnection(this.options);
    this.producer = new Produce({
      facility: this.options.facility,
    });
  }

  log(info: any, callback: any) {
    setImmediate(() => {
      this.emit('logged', info);
    });

    const { [LEVEL]: level, [MESSAGE]: output } = info;
    this.sendMessage(level, output, callback);
  }

  sendMessage(level: any, message: string, callback: any) {
    let lines;
    let msg = '';
    let gap = '';

    // Only split if we actually have a message
    if (message) {
      lines = message.split('\n');
    } else {
      lines = [''];
    }

    // If the incoming message has multiple lines, break them and format each
    // line as its own message
    for (let i = 0; i < lines.length; i++) {
      // don't send extra message if our message ends with a newline
      if (lines[i].length === 0 && i === lines.length - 1) {
        break;
      }

      if (i === 1) {
        gap = '    ';
      }

      // Needs a valid severity - default to "notice" if the map failed.
      const severity = this.options.levels[level] || 5;
      msg +=
        this.producer.produce({
          severity,
          host: this.options.hostname,
          appName: this.options.program,
          date: new Date(),
          message,
        }) + '\r\n';
    }

    this.connection.write(msg, callback);
  }

  close() {
    this.connection.close();
  }
}

export class PapertrailConnection extends EventEmitter {
  private options: PapertrailTransportOptions;
  private connectionDelay: number;
  private currentRetries: number;
  private totalRetries: number;
  private loggingEnabled: boolean;
  private _shutdown: boolean;
  private _erroring: boolean;
  private deferredQueue: any[];
  private stream?: Socket;
  private socket?: Socket;

  constructor(options: PapertrailTransportOptions) {
    super();

    this.options = options;
    if (!this.options.host || !this.options.port) {
      throw new Error('Missing required parameters: host and port');
    }

    this.connectionDelay = this.options.connectionDelay!;
    this.currentRetries = 0;
    this.totalRetries = 0;
    this.loggingEnabled = true;
    this._shutdown = false;
    this._erroring = false;

    /**
     * Dev could instantiate a new logger and then call logger.log immediately.
     * We need a way to put incoming strings (from multiple transports) into
     * a buffer queue.
     */
    this.deferredQueue = [];

    this.connect();
  }

  connect() {
    if (this._shutdown || this._erroring) {
      return;
    }
    this.close();

    try {
      if (this.options.disableTls) {
        this.stream = net.createConnection(this.options.port, this.options.host, () => this.onConnected());
        this.stream.setKeepAlive(true, KEEPALIVE_INTERVAL);
        this.stream.once('error', err => this.onErrored(err));
        this.stream.once('end', () => this.connect());
      } else {
        this.socket = net.createConnection(this.options.port, this.options.host, () => {
          this.socket!.setKeepAlive(true, KEEPALIVE_INTERVAL);
          this.stream = tls.connect(
            {
              socket: this.socket,
              rejectUnauthorized: false,
            },
            () => this.onConnected()
          );
          this.stream.once('error', err => {
            this.onErrored(err);
          });
          this.stream.once('end', () => this.connect());
        });
        this.socket.once('error', err => this.onErrored(err));
      }
    } catch (err) {
      this.onErrored(err);
    }
  }

  write(text: string, callback: any) {
    // If we cannot write at the moment, we add it to the deferred queue for later processing
    if (this.stream?.writable) {
      try {
        this.stream.write(text, callback);
      } catch (e) {
        this.deferredQueue.push({ buffer: text, callback });
      }
    } else {
      this.deferredQueue.push({ buffer: text, callback });
    }
  }

  processBuffer() {
    if (this.deferredQueue.length === 0 || !this.stream || !this.stream.writable) {
      return;
    }
    let msg = this.deferredQueue.pop();
    while (msg) {
      this.stream.write(msg.buffer, msg.callback);
      msg = this.deferredQueue.pop();
    }
    this.stream.emit('empty');
  }

  onConnected() {
    this.loggingEnabled = true;
    this.currentRetries = 0;
    this.totalRetries = 0;
    this.connectionDelay = this.options.connectionDelay!;

    this.processBuffer();

    this.emit('connect', `Connected to Papertrail at ${this.options.host}:${this.options.port}`);
  }

  onErrored(err: any) {
    this._erroring = true;

    this.emitSilentError(err);

    setTimeout(() => {
      if (
        this.connectionDelay < this.options.maxDelayBetweenReconnection! &&
        this.currentRetries >= this.options.attemptsBeforeDecay!
      ) {
        this.connectionDelay = this.connectionDelay * 2;
        this.currentRetries++;
      }

      if (this.loggingEnabled && this.totalRetries >= this.options.maximumAttempts!) {
        this.loggingEnabled = false;
        this.emitSilentError(new Error('Maximum number of retries exceeded, disabling buffering'));
      }

      this._erroring = false;
      this.connect();
    }, this.connectionDelay);
  }

  emitSilentError(err: Error) {
    if (this.listenerCount('error') > 0) {
      this.emit('error', err);
    } else {
      console.error(`Papertrail connection error: ${err}`);
    }
  }

  closeSockets() {
    if (this.socket) {
      this.socket.destroy();
      this.socket = undefined;
    }
    if (this.stream) {
      this.stream.removeAllListeners('end');
      this.stream.removeAllListeners('error');
      this.stream.destroy();
      this.stream = undefined;
    }
  }

  close() {
    // if we encounter errors while closing, we wait and try to close three more times
    const max = 3;
    let attempts = 0;
    this._shutdown = true;
    const _close = () => {
      try {
        if (this.stream) {
          if (this.options.flushOnClose && this.deferredQueue.length > 0) {
            this.stream.on('empty', () => {
              this.closeSockets();
            });
          } else {
            this.closeSockets();
          }
        }
        this._shutdown = false;
      } catch (e) {
        attempts++;
        if (attempts < max) {
          setTimeout(_close, 100 + attempts);
        }
      }
    };
    _close();
  }
}
