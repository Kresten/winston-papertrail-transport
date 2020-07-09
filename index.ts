import tls from 'tls';
import os from 'os';
import util from 'util';
import winston from 'winston';
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
  logFormat?: (level: string, message: string) => string;
  path?: string;
  inlineMeta?: boolean;
  colorize?: boolean;
  // max depth for objects
  depth?: any;
  flushOnClose?: boolean;
  // options for connection failure and retry behavior
  attemptsBeforeDecay?: number;
  maximumAttempts?: number;
  connectionDelay?: number;
  maxDelayBetweenReconnection?: number;
  maxBufferSize?: number;
}

if (Number(winston.version.split('.')[0]) < 3) {
  throw new Error('winston-papertrail-transport requires winston >= 3.0.0');
}

export class PapertrailTransport extends Transport {
  private options: PapertrailTransportOptions;
  public connection: PapertrailConnection;
  private producer: any;
  private connected: boolean;
  private congested: boolean;
  private retries: number;

  get name() {
    return 'papertrail';
  }

  constructor(options: PapertrailTransportOptions) {
    super(options);

    this.connected = false;
    this.congested = false;
    this.retries = 0;

    const defaultOptions: PapertrailTransportOptions = {
      host: 'localhost',
      port: 417,
      inlineMeta: false,
      colorize: false,
      program: 'default',
      facility: 'daemon',
      hostname: os.hostname(),
      depth: null,
      levels: {
        debug: 0,
        info: 1,
        notice: 2,
        warning: 3,
        warn: 3,
        error: 4,
        err: 4,
        crit: 5,
        alert: 6,
        emerg: 7,
      },
      logFormat: function(level: string, message: string) {
        return level + ' ' + message;
      },
      attemptsBeforeDecay: 5,
      maximumAttempts: 25,
      connectionDelay: 1000,
      handleExceptions: false,
      maxDelayBetweenReconnection: 60000,
      // 1 MB
      maxBufferSize: 1024 * 1024,
      flushOnClose: false,
      disableTls: false,
    };

    this.connection = new PapertrailConnection(options);

    //
    // Merge the options for the target Papertrail server.
    //
    this.options = Object.assign({}, defaultOptions, options);
    this.producer = new Produce({
      facility: this.options.facility,
    });
  }

  log(info: any, callback: any) {
    setImmediate(() => {
      this.emit('logged', info);
    });

    const { level, message, meta } = info;

    let output = message;

    if (meta) {
      if (typeof meta !== 'object') {
        output += ' ' + meta;
      } else if (meta) {
        if (this.options.inlineMeta) {
          output +=
            ' ' +
            util
              .inspect(meta, {
                showHidden: false,
                depth: this.options.depth,
                colors: this.options.colorize,
              })
              .replace(/[\n\t]\s*/gm, ' ');
        } else {
          output += '\n' + util.inspect(meta, false, this.options.depth, this.options.colorize);
        }
      }
    }

    this.sendMessage(level, output, callback);
  }

  sendMessage(level: any, message: string, callback: any) {
    let lines = [];
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

      // Strip escape characters (for colorization)
      const cleanedLevel = level.replace(/\u001b\[\d+m/g, '');
      msg +=
        this.producer.produce({
          severity: this.options.levels[cleanedLevel] || cleanedLevel,
          host: this.options.hostname,
          appName: this.options.program,
          date: new Date(),
          message: this.options.logFormat!(level, gap + lines[i]),
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
          this.stream.once('error', err => this.onErrored(err));
          this.stream.once('end', () => this.connect());
        });

        this.socket.once('error', err => this.onErrored(err));
      }
    } catch (err) {
      this.onErrored(err);
    }
  }

  write(text: string, callback: any) {
    // If the stream is writable
    if (this.stream && this.stream.writable) {
      this.stream.write(text, callback);
    } else {
      // Otherwise, store it in a buffer and write it when we're connected
      this.deferredQueue.push({
        buffer: text,
        callback,
      });
    }
  }

  processBuffer() {
    if (this.deferredQueue.length === 0 || !this.stream || !this.stream.writable) {
      return;
    }
    let msg = this.deferredQueue.shift();
    while (msg) {
      this.stream.write(msg.buffer, msg.callback);
      msg = this.deferredQueue.shift();
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

  close() {
    const max = 6;
    let attempt = 0;
    const closeStream = () => {
      this.stream!.removeListener('end', this.connect);
      this.stream!.removeListener('error', this.onErrored);
      this.stream!.destroy();
      this.stream = undefined;
    };
    const _close = () => {
      if (attempt >= max || this.deferredQueue.length <= 0) {
        this._shutdown = true;
        try {
          if (this.socket) {
            this.socket.destroy();
            this.socket = undefined;
          }
          if (this.stream) {
            if (this.options.flushOnClose && this.deferredQueue.length > 0) {
              this.stream.on('empty', () => {
                closeStream();
              });
            } else {
              closeStream();
            }
          }
        } catch (e) {
          attempt++;
          setTimeout(_close, 200 * attempt);
        }
      } else {
        attempt++;
        setTimeout(_close, 200 * attempt);
      }
    };
    _close();
  }
}
