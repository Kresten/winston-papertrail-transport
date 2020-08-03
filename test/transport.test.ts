import { PapertrailConnection, PapertrailTransport } from '../index';
import * as tls from 'tls';
import * as fs from 'fs';
import * as net from 'net';
import { Server } from 'net';
import { LEVEL, MESSAGE } from 'triple-beam';

/**
 * tests from https://github.com/kenperkins/winston-papertrail/blob/v2/test/papertrail-test.js
 */

const _noop = () => {};

describe('winston-papertrail-transport', () => {
  let pc: PapertrailConnection;
  let pt: PapertrailTransport;
  afterEach(() => {
    if (pc) {
      pc.close();
      (pc as any) = undefined;
    }
    if (pt) {
      pt.close();
      (pt as any) = undefined;
    }
  });
  describe('invalid configurations', () => {
    it('should fail to connect', done => {
      pc = new PapertrailConnection({
        host: 'this.wont.resolve',
        port: 12345,
        attemptsBeforeDecay: 0,
        connectionDelay: 10000,
      });

      pc.on('error', err => {
        expect(err).toBeDefined();
        done();
      });
    });
  });

  describe('valid connection over tls', () => {
    let server: any;
    let listener: any = _noop;

    beforeAll(done => {
      server = tls.createServer(
        {
          key: fs.readFileSync('./test/server.key'),
          cert: fs.readFileSync('./test/server.crt'),
          rejectUnauthorized: false,
        },
        socket => {
          socket.on('data', listener);
        }
      );

      server.listen(23456, () => {
        done();
      });
    });

    it('should connect', done => {
      pc = new PapertrailConnection({
        host: 'localhost',
        port: 23456,
        attemptsBeforeDecay: 0,
        connectionDelay: 10000,
      });

      pc.on('error', err => {
        expect(err).not.toBeDefined();
      });

      pc.on('connect', () => {
        done();
      });
    });

    it('should connect a bunch without exploding', done => {
      let connects = 0;
      const pcs: { [key: string]: PapertrailConnection } = {};
      for (let i = 0; i < 5; i++) {
        const key = 'pt' + i;
        pcs[key] = new PapertrailConnection({
          host: 'localhost',
          port: 23456,
          attemptsBeforeDecay: 0,
          connectionDelay: 100,
        });
        pcs[key].on('error', (err: any) => {
          expect(err).not.toBeDefined();
        });
        pcs[key].on('connect', () => {
          connects++;
          if (connects === 4) {
            for (const key of Object.keys(pcs)) {
              pcs[key].close();
            }
            done();
          }
        });
      }
    });

    it('should send message', done => {
      pt = new PapertrailTransport({
        host: 'localhost',
        port: 23456,
        attemptsBeforeDecay: 0,
        connectionDelay: 10000,
      });

      pt.connection.on('error', err => {
        expect(err).not.toBeDefined();
      });

      pt.connection.on('connect', () => {
        pt.log({ [LEVEL]: 'info', [MESSAGE]: 'hello' }, _noop);
      });

      listener = (data: any) => {
        expect(data).toBeDefined();
        expect(data.toString().indexOf('default - - - hello\r\n')).not.toBe(-1);
        done();
      };
    });

    it('should write buffered events before new events', done => {
      pt = new PapertrailTransport({
        host: 'localhost',
        port: 23456,
        attemptsBeforeDecay: 0,
        connectionDelay: 10000,
      });
      pt.log({ [LEVEL]: 'info', [MESSAGE]: 'first' }, _noop);

      pt.connection.on('error', err => {
        expect(err).not.toBeDefined();
      });

      pt.connection.on('connect', () => {
        pt.log({ [LEVEL]: 'info', [MESSAGE]: 'second' }, _noop);
      });

      let gotFirst = false;
      listener = (data: any) => {
        if (gotFirst) {
          return;
        }
        expect(data).toBeDefined();
        const lines = data.toString().split('\r\n');
        expect(lines[0]).toMatch('first');
        gotFirst = true;
        done();
      };
    });

    // TODO need to fix the TLS Server to reject new sockets that are not over tls
    it.skip('should fail to connect without tls', done => {
      pt = new PapertrailTransport({
        host: 'localhost',
        port: 23456,
        attemptsBeforeDecay: 0,
        connectionDelay: 10000,
      });

      pt.connection.on('error', err => {
        expect(err).toBeDefined();
        done();
      });
    });

    // connects, then closes, ensure what we wanted was written.
    it('flushOnClose should write buffered events before closing the stream', done => {
      pt = new PapertrailTransport({
        host: 'localhost',
        port: 23456,
        attemptsBeforeDecay: 0,
        connectionDelay: 10000,
      });

      pt.log(
        {
          [LEVEL]: 'info',
          [MESSAGE]: 'buffered',
        },
        _noop
      );

      pt.connection.close();

      pt.connection.on('error', err => {
        expect(err).not.toBeDefined();
      });

      pt.connection.on('connect', () => {
        pt.connection.close();
      });

      listener = (data: any) => {
        expect(data).toBeDefined();
        const lines = data.toString().split('\r\n');
        expect(lines[0]).toMatch('buffered');
        done();
      };
    });

    afterAll(done => {
      server.close();
      done();
    });
  });

  describe('valid connection over tcp', () => {
    let server: Server;
    let listener: any = _noop;

    beforeEach(done => {
      server = net.createServer({}, socket => {
        socket.on('data', listener);
      });

      server.listen(23456, () => {
        done();
      });
    });
    afterEach(done => {
      server.close();
      done();
    });

    it('should connect', done => {
      pt = new PapertrailTransport({
        host: 'localhost',
        port: 23456,
        disableTls: true,
        attemptsBeforeDecay: 0,
        connectionDelay: 10000,
      });

      pt.connection.on('error', err => {
        expect(err).not.toBeDefined();
      });

      pt.connection.on('connect', () => {
        done();
      });
    });

    it('should send message', done => {
      pt = new PapertrailTransport({
        host: 'localhost',
        port: 23456,
        disableTls: true,
        attemptsBeforeDecay: 0,
        connectionDelay: 10000,
      });

      pt.connection.on('error', err => {
        expect(err).not.toBeDefined();
      });

      pt.connection.on('connect', () => {
        pt.log(
          {
            [LEVEL]: 'info',
            [MESSAGE]: 'hello',
          },
          _noop
        );
      });

      listener = (data: any) => {
        expect(data).toBeDefined();
        expect(data.toString().indexOf('default - - - hello\r\n')).not.toEqual(-1);
        done();
      };
    });

    // TODO now it just hangs
    it.skip('should fail to connect via tls', function(done) {
      pt = new PapertrailTransport({
        host: 'localhost',
        port: 23456,
        attemptsBeforeDecay: 0,
        connectionDelay: 10000,
      });

      pt.connection.on('error', err => {
        expect(err).toBeDefined();
        done();
      });
    });
  });
});
