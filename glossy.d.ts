declare module 'glossy' {
  export class Produce {
    constructor(options: {
      facility?: string | number;
      severity?: string | number;
      host?: string;
      appName?: string;
      pid?: string | number;
      msgID?: string;
      type?: string;
    });
  }
}
