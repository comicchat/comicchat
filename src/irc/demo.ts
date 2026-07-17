// Offline demo room: scripted characters so the comic engine can be enjoyed
// (and tested) with zero network.

import { ChatSession, type BalloonKind, type CCMeta, type SessionOptions } from './session';

interface Line {
  from: string;
  kind: BalloonKind;
  text: string;
  delay: number; // ms after previous line
  toUser?: boolean; // whisper directly to the user
}

const BOTS: { nick: string; characterId: string }[] = [
  { nick: 'Anna', characterId: 'anna' },
  { nick: 'Dan', characterId: 'dan' },
  { nick: 'Margaret', characterId: 'margaret' },
  { nick: 'Xeno', characterId: 'xeno' },
];

const SCRIPT: Line[] = [
  { from: 'Anna', kind: 'say', text: 'Hello everybody! Welcome to the comic chat revival.', delay: 1800 },
  { from: 'Dan', kind: 'say', text: 'Whoa. Is this really 1996 again?', delay: 3200 },
  { from: 'Margaret', kind: 'think', text: 'I never thought I would see this place again...', delay: 3600 },
  { from: 'Xeno', kind: 'say', text: 'GREETINGS EARTHLINGS!!!', delay: 2800 },
  { from: 'Anna', kind: 'say', text: 'Xeno, you don\'t have to shout :-)', delay: 3400 },
  { from: 'Dan', kind: 'action', text: 'puts on his sunglasses', delay: 3000 },
  { from: 'Margaret', kind: 'say', text: 'So how does it work? Type something and you become part of the comic!', delay: 4200 },
  { from: 'Xeno', kind: 'whisper', text: 'psst... try the emotion wheel in the corner', delay: 3600, toUser: true },
  { from: 'Dan', kind: 'say', text: 'I LOVE IT! This is awesome!!', delay: 3800 },
  { from: 'Anna', kind: 'say', text: 'Are you going to draw us all day?', delay: 4200 },
  { from: 'Margaret', kind: 'say', text: 'ha ha ha, probably!', delay: 3000 },
  { from: 'Xeno', kind: 'think', text: 'humans are strange', delay: 4000 },
];

const REPLIES: { pattern: RegExp; lines: [string, BalloonKind, string][] }[] = [
  { pattern: /hello|hi\b|hey|greetings/i, lines: [
    ['Anna', 'say', 'Well hello there!'],
    ['Dan', 'say', 'Hey! Good to see a new face.'],
  ]},
  { pattern: /\?$/, lines: [
    ['Margaret', 'say', 'Good question. Nobody knows!'],
    ['Xeno', 'say', 'The answer is 42, obviously.'],
  ]},
  { pattern: /bye|later|good ?night/i, lines: [
    ['Anna', 'say', 'Bye! Come back soon.'],
    ['Dan', 'action', 'waves goodbye'],
  ]},
  { pattern: /love|great|awesome|cool|amazing/i, lines: [
    ['Dan', 'say', 'Right?! Totally awesome.'],
    ['Anna', 'say', 'I\'m so glad you like it :-)'],
  ]},
  { pattern: /.*/, lines: [
    ['Xeno', 'say', 'Fascinating. Tell me more.'],
    ['Margaret', 'say', 'Interesting point!'],
    ['Dan', 'say', 'ha! classic.'],
    ['Anna', 'think', 'I wonder what they mean by that...'],
  ]},
];

export class DemoSession extends ChatSession {
  private timers: ReturnType<typeof setTimeout>[] = [];
  private scriptPos = 0;
  private replyCursor = new Map<string, number>();

  constructor(opts: SessionOptions) {
    super(opts);
  }

  get nick() { return this.opts.nick; }

  connect() {
    this.emit({ type: 'status', status: 'connecting' });
    this.later(400, () => {
      this.emit({ type: 'status', status: 'registered' });
      this.joinRoom(this.opts.channel);
    });
  }

  disconnect() {
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
    this.emit({ type: 'status', status: 'disconnected' });
  }

  joinRoom(channel: string) {
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
    this.opts.channel = channel;
    this.later(300, () => {
      this.emit({ type: 'joined', channel });
      if (channel.toLowerCase() === '#comicchat') {
        // The scripted room: bots live here.
        this.emit({
          type: 'members', channel,
          nicks: [this.opts.nick, ...BOTS.map((b) => b.nick)],
        });
        for (const b of BOTS) this.announceBot(b.nick, b.characterId);
        if (this.scriptPos < SCRIPT.length) this.scheduleNextLine(1200);
      } else {
        // Any other room is empty except you.
        this.emit({ type: 'members', channel, nicks: [this.opts.nick] });
        this.emit({ type: 'info', text: `You are alone in ${channel}. The scripted characters live in #comicchat.` });
      }
    });
  }

  leaveRoom() {
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
    this.emit({ type: 'part', channel: this.opts.channel, nick: this.opts.nick });
  }

  sendMessage(kind: BalloonKind, text: string, cc: CCMeta, whisperTo?: string) {
    this.emit({
      type: 'message',
      msg: {
        from: this.opts.nick,
        target: whisperTo ?? this.opts.channel,
        kind, text, cc, self: true, time: Date.now(),
      },
    });
    // Bots occasionally respond (they only live in #comicchat).
    if (this.opts.channel.toLowerCase() === '#comicchat' && Math.random() < 0.75) {
      const rule = REPLIES.find((r) => r.pattern.test(text))!;
      const cursor = this.replyCursor.get(rule.pattern.source) ?? 0;
      const [from, k, reply] = rule.lines[cursor % rule.lines.length];
      this.replyCursor.set(rule.pattern.source, cursor + 1);
      this.later(1500 + Math.random() * 2500, () => this.botLine(from, k, reply));
    }
  }

  announceCharacter(_cc: CCMeta) { /* nothing to do offline */ }

  requestRoomList() {
    this.emit({
      type: 'roomlist',
      rooms: [
        { name: '#comicchat', users: 5, topic: 'The comic chat revival — demo room' },
        { name: '#lobby', users: 12, topic: 'General chatter' },
        { name: '#26-40something', users: 33, topic: '' },
        { name: '#worldchat', users: 171, topic: 'Just us chumps' },
      ],
    });
  }

  requestProfile(nick: string) {
    this.emit({ type: 'profile', nick, text: 'I am a scripted demo character. My favorite room is #comicchat.' });
  }

  requestIdentity(nick: string) {
    this.emit({ type: 'identity', nick, text: `${nick} is ${nick.toLowerCase()}!demo@comicchat.local\nReal name: Demo character` });
  }

  requestVersion(nick: string) {
    this.emit({ type: 'info', text: `${nick} is using: Comic Chat for the Web (demo)` });
  }

  requestLagTime(nick: string) {
    this.emit({ type: 'info', text: `Lag time to ${nick}: 0.00 seconds.` });
  }

  requestLocalTime(nick: string) {
    this.emit({ type: 'info', text: `Local time for ${nick}: ${new Date().toString()}` });
  }

  requestMotd() {
    this.emit({ type: 'motd', text: 'Welcome to the Comic Chat demo room!\nEverything here runs offline in your browser.' });
  }

  setAway(away: boolean) {
    this.emit({ type: 'info', text: away ? 'You have been marked as being away.' : 'You are no longer marked as being away.' });
  }

  invite(nick: string) {
    this.emit({ type: 'info', text: `Invited ${nick} to ${this.opts.channel}. (demo)` });
  }

  setTopic(topic: string) {
    this.emit({ type: 'topic', channel: this.opts.channel, topic });
  }

  private announceBot(nick: string, characterId: string) {
    // Delivered as a metadata-only message event so the app learns bot avatars.
    this.emit({
      type: 'message',
      msg: {
        from: nick, target: this.opts.channel, kind: 'say', text: '',
        cc: { characterId }, self: false, time: Date.now(),
      },
    });
  }

  private scheduleNextLine(extraDelay = 0) {
    if (this.scriptPos >= SCRIPT.length) return;
    const line = SCRIPT[this.scriptPos];
    this.later(line.delay + extraDelay, () => {
      this.botLine(line.from, line.kind, line.text, line.toUser);
      this.scriptPos++;
      this.scheduleNextLine();
    });
  }

  private botLine(from: string, kind: BalloonKind, text: string, toUser = false) {
    const bot = BOTS.find((b) => b.nick === from)!;
    this.emit({
      type: 'message',
      msg: {
        from,
        target: toUser ? this.opts.nick : this.opts.channel,
        kind, text,
        cc: { characterId: bot.characterId }, self: false, time: Date.now(),
      },
    });
  }

  private later(ms: number, fn: () => void) {
    this.timers.push(setTimeout(fn, ms));
  }
}
