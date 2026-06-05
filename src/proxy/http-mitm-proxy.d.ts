declare module 'http-mitm-proxy' {
  import type { EventEmitter } from 'events';
  import type * as http from 'http';

  export interface IProxyOptions {
    port?: number;
    host?: string;
    sslCaDir?: string;
    forceSNI?: boolean;
    httpsPort?: number;
  }

  export interface IContext {
    clientToProxyRequest: http.IncomingMessage;
    serverToProxyResponse?: http.IncomingMessage;
    isSSL?: boolean;
    onRequestData(
      fn: (
        ctx: IContext,
        chunk: Buffer,
        callback: (err: Error | null, chunk: Buffer) => void
      ) => void
    ): void;
    onRequestEnd(fn: (ctx: IContext, callback: () => void) => void): void;
    onResponseData(
      fn: (
        ctx: IContext,
        chunk: Buffer,
        callback: (err: Error | null, chunk: Buffer) => void
      ) => void
    ): void;
    onResponseEnd(fn: (ctx: IContext, callback: () => void) => void): void;
  }

  export class Proxy extends EventEmitter {
    onError(
      fn: (
        ctx: IContext | null,
        err: Error,
        errorKind?: string
      ) => void
    ): void;
    onRequest(fn: (ctx: IContext, callback: () => void) => void): void;
    onResponse(fn: (ctx: IContext, callback: () => void) => void): void;
    listen(options: IProxyOptions, callback?: (err?: Error) => void): void;
    close(callback?: () => void): void;
  }
}
