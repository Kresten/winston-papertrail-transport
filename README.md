# winston-papertrail-transport

A Papertrail transport for [winston ^3.0.0][0].
Heavily inspired by and borrows from [winston-papertrail][1] and [winston-syslog][2]

## Requirements

- winston >= 3.0.0

## Installation

### Installing npm (node package manager)

```bash
  $ curl http://npmjs.org/install.sh | sh
```

### Installing winston-papertrail-transport

```bash
  $ npm install winston
  $ npm install winston-papertrail-transport
```

The following options are required for logging to Papertrail:

- **host:** FQDN or IP Address of the Papertrail Service Endpoint
- **port:** The Endpoint TCP Port

The following options are optional

- **disableTls:** Disable TLS on the transport. Defaults to `false`.
- **level:** The log level to use for this transport. Defaults to `info`.
- **levels:** A mapping of log level strings to severity levels. Defaults to the mapping of npm levels to RFC5424 severities.
- **hostname:** The hostname for your transport. Defaults to `os.hostname()`.
- **program:** The program for your transport. Defaults to `default`.
- **facility:** The syslog facility for this transport. Defaults to `daemon`.
- **logFormat:** A function to format your log message before sending. Defaults to `` (level, message) => `${level} ${message}`; ``.
- **colorize:** Enables ANSI colors in logs. Defaults to `false`.
- **inlineMeta:** Inline multi-line messages. Defaults to `false`.
- **handleExceptions:** Make transport handle exceptions. Defaults to `false`.
- **flushOnClose:** Flush queued logs in close. Defaults to `false`.
- **depth:** Max depth for objects dumped by NodeJS `util.inspect`. Defaults to `null`, which means no limit.
- **attemptsBeforeDecay:** The number of retries attempted before backing off. Defaults to `5`.
- **maximumAttempts:** The number of retries attempted before buffering is disabled. Defaults to `25`.
- **connectionDelay:** The number of time between connection retries in ms attempted before buffering is disabled. Defaults to `1000`.
- **connectionDelay:** The maximum number of time between connection retries in ms allowed. Defaults to `60000`.
- **connectionDelay:** The maximum size of the retry buffer in bytes. Defaults to `1024 * 1024`.

## Example usage

Here is an example on how the papertrail transport can be used together with the console transport in a typescript express app. The example also modifies some settings to yield a meaningful log line in Papertrail.

```typescript
import * as packageFile from './package.json';
import * as winston from 'winston';
import expressWinston from 'express-winston';
import { PapertrailTransport } from 'winston-papertrail-transport';

const hostname = `${packageFile.name}:${process.env.NODE_ENV}`;

const container = new winston.Container();

function getConfig(program: string) {
  const transports = [];

  const consoleTransport = new winston.transports.Console();
  transports.push(consoleTransport);

  const papertrailTransport = new PapertrailTransport({
    host: 'logs.papertrailapp.com',
    port: 1234,
    colorize: true,
    hostname: hostname,
    program,
  });
  transports.push(papertrailTransport);

  return {
    format: winston.format.combine(winston.format.colorize(), winston.format.simple()),
    transports,
  };
}

export function newLogger(program: string) {
  return container.add(program, getConfig(program));
}

export const expressLogger = expressWinston.logger({
  ...getConfig('router'),
  meta: false,
  metaField: null,
  expressFormat: true,
  colorize: true,
});
```

`express-logger` will print

`Jul 09 12:55:43 exampleApp:development router info GET / 304 9ms`

`newLogger('server').info('listening')` will print

`Jul 09 12:56:35 exampleApp:development server info listening`

[0]: https://github.com/winstonjs/winston
[1]: https://github.com/kenperkins/winston-papertrail
[2]: https://github.com/winstonjs/winston-syslog
