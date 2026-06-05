/** HTTP application protocol version observed on the MITM leg. */
export type HttpProtocolVersion = 'HTTP/1.0' | 'HTTP/1.1' | 'HTTP/2';

export const DEFAULT_ALPN_PROTOCOLS = ['h2', 'http/1.1', 'http/1.0'] as const;
