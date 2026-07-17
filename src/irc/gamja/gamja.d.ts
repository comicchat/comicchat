// Loose typings for the vendored gamja IRC library.

declare module '*/gamja/client.js' {
  export interface ClientParams {
    url: string;
    pass?: string | null;
    username?: string | null;
    realname?: string | null;
    nick: string;
    saslPlain?: { username: string; password: string } | null;
    autoconnect?: boolean;
    eventPlayback?: boolean;
  }
  export default class Client extends EventTarget {
    static Status: Record<string, string>;
    status: string;
    nick: string;
    autoReconnect: boolean;
    serverPrefix: unknown;
    isupport: Map<string, string>;
    constructor(params: ClientParams);
    reconnect(): void;
    disconnect(): void;
    send(msg: { tags?: Record<string, string>; command: string; params?: string[] }): void;
    isMyNick(nick: string): boolean;
    isChannel(name: string): boolean;
    cm(name: string): string;
  }
}

declare module '*/gamja/irc.js' {
  export interface Message {
    tags: Record<string, string>;
    prefix: { name: string; user?: string; host?: string } | null;
    command: string;
    params: string[];
  }
  export function parseMessage(line: string): Message;
  export function formatMessage(msg: Partial<Message>): string;
  export function parsePrefix(s: string): { name: string; user?: string; host?: string };
  export function parseCTCP(msg: Message): { command: string; param: string } | null;
  export const RPL_WELCOME: string;
  export const RPL_NAMREPLY: string;
  export const RPL_ENDOFNAMES: string;
  export const ERR_NICKNAMEINUSE: string;
}
