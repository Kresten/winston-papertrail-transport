import { PapertrailConnection, PapertrailTransport } from '../index';
import * as tls from 'tls';
import * as fs from 'fs';
import * as net from 'net';
import { Server } from 'net';

/**
 * tests from https://github.com/kenperkins/winston-papertrail/blob/v2/test/papertrail-test.js
 */

const _noop = () => {};

describe('winston-papertrail-transport', () => {
  describe('invalid', () => {
    it('should fail to connect', done => {
      const pt = new PapertrailConnection({
        host: 'this.wont.resolve',
        port: 12345,
        attemptsBeforeDecay: 0,
        connectionDelay: 10000,
      });

      pt.on('error', err => {
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
      const pt = new PapertrailConnection({
        host: 'localhost',
        port: 23456,
        attemptsBeforeDecay: 0,
        connectionDelay: 10000,
      });

      pt.on('error', err => {
        expect(err).not.toBeDefined();
      });

      pt.on('connect', () => {
        done();
      });
    });

    it('should connect a bunch without exploding', done => {
      let connects = 0;
      const pts: any = {};
      for (let i = 0; i < 5; i++) {
        const key = 'pt' + i;
        pts[key] = new PapertrailConnection({
          host: 'localhost',
          port: 23456,
          attemptsBeforeDecay: 0,
          connectionDelay: 100,
        });
        pts[key].on('error', (err: any) => {
          expect(err).not.toBeDefined();
        });
        pts[key].on('connect', () => {
          connects++;
          if (connects === 4) {
            done();
          }
        });
      }
    });

    it('should send message', done => {
      const pt = new PapertrailTransport({
        host: 'localhost',
        port: 23456,
        attemptsBeforeDecay: 0,
        connectionDelay: 10000,
      });

      pt.connection.on('error', err => {
        expect(err).not.toBeDefined();
      });

      pt.connection.on('connect', () => {
        pt.log(
          {
            level: 'info',
            message: 'hello',
          },
          _noop
        );
      });

      listener = (data: any) => {
        expect(data).toBeDefined();
        expect(data.toString().indexOf('default - - - info hello\r\n')).not.toBe(-1);
        done();
      };
    });

    it('should write buffered events before new events', done => {
      const pt = new PapertrailTransport({
        host: 'localhost',
        port: 23456,
        attemptsBeforeDecay: 0,
        connectionDelay: 10000,
      });
      pt.log(
        {
          level: 'info',
          message: 'first',
        },
        _noop
      );

      pt.connection.on('error', err => {
        expect(err).not.toBeDefined();
      });

      pt.connection.on('connect', () => {
        pt.log(
          {
            level: 'info',
            message: 'second',
          },
          _noop
        );
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

    it('should support object meta', done => {
      const pt = new PapertrailTransport({
        host: 'localhost',
        port: 23456,
        attemptsBeforeDecay: 0,
        connectionDelay: 10000,
      });

      pt.connection.on('error', err => {
        expect(err).not.toBeDefined();
      });

      pt.connection.on('connect', () => {
        pt.log(
          {
            level: 'info',
            message: 'hello',
            meta: {
              foo: 'bar',
            },
          },
          _noop
        );
      });

      listener = (data: any) => {
        expect(data).toBeDefined();
        expect(data.toString().indexOf('default - - - info hello\r\n')).not.toBe(-1);
        expect(data.toString().indexOf("{ foo: 'bar' }\r\n")).not.toBe(-1);
        done();
      };
    });

    it('should support array meta', done => {
      const pt = new PapertrailTransport({
        host: 'localhost',
        port: 23456,
        attemptsBeforeDecay: 0,
        connectionDelay: 10000,
      });

      pt.connection.on('error', err => {
        expect(err).not.toBeDefined();
      });

      pt.connection.on('connect', () => {
        pt.log(
          {
            level: 'info',
            message: 'hello',
            meta: ['object'],
          },
          _noop
        );
      });

      listener = (data: any) => {
        expect(data).toBeDefined();
        expect(data.toString().indexOf('default - - - info hello\r\n')).not.toBe(-1);
        expect(data.toString().indexOf('object')).not.toBe(-1);
        done();
      };
    });

    it('should support null meta', done => {
      const pt = new PapertrailTransport({
        host: 'localhost',
        port: 23456,
        attemptsBeforeDecay: 0,
        connectionDelay: 10000,
      });

      pt.connection.on('error', err => {
        expect(err).not.toBeDefined();
      });

      pt.connection.on('connect', () => {
        pt.log(
          {
            level: 'info',
            message: 'hello',
            meta: null,
          },
          _noop
        );
      });

      listener = (data: any) => {
        expect(data).toBeDefined();
        expect(data.toString().indexOf('default - - - info hello\r\n')).not.toBe(-1);
        done();
      };
    });

    it('should support non-object meta', done => {
      const pt = new PapertrailTransport({
        host: 'localhost',
        port: 23456,
        attemptsBeforeDecay: 0,
        connectionDelay: 10000,
      });

      pt.connection.on('error', err => {
        expect(err).not.toBeDefined();
      });

      pt.connection.on('connect', () => {
        pt.log(
          {
            level: 'info',
            message: 'hello',
            meta: 'meta string',
          },
          _noop
        );
      });

      listener = (data: any) => {
        expect(data).toBeDefined();
        expect(data.toString().indexOf('default - - - info hello meta string\r\n')).not.toBe(-1);
        done();
      };
    });

    // TODO need to fix the TLS Server to reject new sockets that are not over tls
    it.skip('should fail to connect without tls', done => {
      const pt = new PapertrailTransport({
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
      const pt = new PapertrailTransport({
        host: 'localhost',
        port: 23456,
        attemptsBeforeDecay: 0,
        connectionDelay: 10000,
      });

      pt.log(
        {
          level: 'info',
          message: 'buffered',
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
      const pt = new PapertrailTransport({
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
      const pt = new PapertrailTransport({
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
            level: 'info',
            message: 'hello',
          },
          _noop
        );
      });

      listener = (data: any) => {
        expect(data).toBeDefined();
        expect(data.toString().indexOf('default - - - info hello\r\n')).not.toEqual(-1);
        done();
      };
    });

    // TODO now it just hangs
    it.skip('should fail to connect via tls', function(done) {
      const pt = new PapertrailTransport({
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
