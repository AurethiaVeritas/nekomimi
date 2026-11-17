declare module 'tunnel-agent' {
  import type { Agent as HttpAgent } from 'node:http';
  import type { Agent as HttpsAgent } from 'node:https';

  interface ProxyOptions {
    host: string;
    port: number;
    proxyAuth?: string;
  }

  interface TunnelOptions {
    proxy: ProxyOptions;
  }

  export function httpOverHttp(options: TunnelOptions): HttpAgent;
  export function httpsOverHttp(options: TunnelOptions): HttpsAgent;
}
