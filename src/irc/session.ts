// Chat session abstraction: the interface for a real IRC session (over
// WebSocket) speaking the Comic Chat wire protocol.

export type BalloonKind = 'say' | 'think' | 'whisper' | 'action';

/** Comic Chat metadata attached to a message (mirrors the original wire UDI). */
export interface CCMeta {
  characterId?: string; // sender's avatar name (lowercase .avb basename)
  characterUrl?: string;
  faceIndex?: number; // E section: face record index
  torsoIndex?: number; // G section: torso record index
  emotionIndex?: number; // E: face emotion (emFloats index)
  intensity?: number; // E: face intensity 0..1
  torsoEmotionIndex?: number; // G: torso emotion (emFloats index)
  torsoIntensity?: number; // G: torso intensity 0..1
  requested?: boolean; // R flag
  talkTos?: string[]; // T list (nicks)
}

export interface ChatMessage {
  from: string;
  target: string;
  kind: BalloonKind;
  text: string;
  cc: CCMeta | null;
  self: boolean;
  time: number;
}

export interface RoomListEntry {
  name: string;
  users: number;
  topic: string;
}

export type SessionEvent =
  | {
      type: 'status';
      status: 'connecting' | 'registered' | 'disconnected' | 'error';
      detail?: string;
    }
  | { type: 'joined'; channel: string }
  | { type: 'members'; channel: string; nicks: string[] }
  | { type: 'join'; channel: string; nick: string }
  | { type: 'part'; channel: string; nick: string; reason?: string }
  | { type: 'nick'; oldNick: string; newNick: string }
  | { type: 'background'; backgroundId: string; from: string }
  | { type: 'info'; text: string } // status-window line
  | { type: 'identity'; nick: string; text: string } // WHOIS result
  | { type: 'profile'; nick: string; text: string } // '# HeresInfo' result
  | { type: 'topic'; channel: string; topic: string }
  | { type: 'roomlist'; rooms: RoomListEntry[] }
  | { type: 'motd'; text: string }
  | { type: 'message'; msg: ChatMessage };

export interface SessionOptions {
  url: string; // ws:// / wss:// endpoint
  nick: string;
  channel: string;
  characterId: string;
  password?: string;
  // What to do once registered, mirroring the original Connect dialog's radio:
  // join a room, list all rooms, or just connect. Defaults to 'room'.
  action?: 'room' | 'list' | 'connectonly';
  profile?: string; // "brief description of yourself" (# HeresInfo)
}

export abstract class ChatSession extends EventTarget {
  opts: SessionOptions;

  constructor(opts: SessionOptions) {
    super();
    this.opts = opts;
  }

  emit(ev: SessionEvent) {
    this.dispatchEvent(new CustomEvent('session', { detail: ev }));
  }

  onEvent(fn: (ev: SessionEvent) => void) {
    this.addEventListener('session', (e) => fn((e as CustomEvent<SessionEvent>).detail));
  }

  abstract connect(): void;
  abstract disconnect(): void;
  abstract get nick(): string;
  abstract sendMessage(kind: BalloonKind, text: string, cc: CCMeta, whisperTo?: string): void;
  /** Announce a character/emotion change without a message (profile update). */
  abstract announceCharacter(cc: CCMeta): void;

  // Member/room commands (no-ops where a backend doesn't support them).
  joinRoom(_channel: string) {}
  leaveRoom() {}
  requestRoomList() {}
  requestProfile(_nick: string) {} // '# GetInfo'
  requestIdentity(_nick: string) {} // WHOIS
  requestVersion(_nick: string) {} // CTCP VERSION
  requestLagTime(_nick: string) {} // CTCP PING
  requestLocalTime(_nick: string) {} // CTCP TIME
  requestMotd() {}
  setAway(_away: boolean, _message?: string) {}
  invite(_nick: string) {}
  setTopic(_topic: string) {}
  announceBackground(_backgroundId: string) {}
}
