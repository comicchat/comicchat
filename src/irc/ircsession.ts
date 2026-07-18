// Real IRC session over WebSocket, built on the vendored gamja client,
// speaking the authentic Comic Chat wire protocol.

import Client from './gamja/client.js';
import * as irc from './gamja/irc.js';
import { ChatSession, type BalloonKind, type CCMeta, type RoomListEntry } from './session';
import {
  buildAnnotation,
  buildAppearsAs,
  buildBDrop,
  buildGetCharInfo,
  buildHeresInfo,
  parseAnnotation,
  parseHashCommand,
  type OutgoingPose,
} from './protocol';

const VERSION_REPLY = 'Comic Chat for the Web (Microsoft Chat 2.5 protocol)';

export class IrcSession extends ChatSession {
  private client: Client | null = null;
  private joined = false;
  profile = 'Chatting from Comic Chat for the Web.';
  private roomList: RoomListEntry[] = [];
  private pendingPings = new Map<string, number>();
  private motdLines: string[] = [];

  get nick() {
    return this.client?.nick ?? this.opts.nick;
  }

  connect() {
    if (this.opts.profile) this.profile = this.opts.profile;
    this.emit({ type: 'status', status: 'connecting' });
    const client = new Client({
      url: this.opts.url,
      nick: this.opts.nick,
      username: this.opts.nick.replace(/[^a-zA-Z0-9]/g, '') || 'comicchat',
      realname: 'Comic Chat Web user',
      pass: this.opts.password || null,
    });
    this.client = client;

    client.addEventListener('status', () => {
      if (client.status === Client.Status.REGISTERED) {
        this.emit({ type: 'status', status: 'registered' });
        if (client.nick && client.nick !== this.opts.nick) {
          this.emit({
            type: 'info',
            text: `Nickname "${this.opts.nick}" was already in use; you are now known as "${client.nick}".`,
          });
        }
        if (!this.joined) {
          // Mirror the Connect dialog's action. Once we've actually joined a
          // room (see the JOIN handler), opts.action is pinned to 'room' so a
          // later reconnect rejoins it rather than re-listing.
          const action = this.opts.action ?? 'room';
          if (action === 'room') {
            client.send({ command: 'JOIN', params: [this.opts.channel] });
          } else if (action === 'list') {
            client.send({ command: 'LIST', params: [] });
          }
          // 'connectonly' → stay connected without joining
        }
      } else if (client.status === Client.Status.DISCONNECTED) {
        this.joined = false;
        this.emit({ type: 'status', status: 'disconnected' });
      }
    });

    client.addEventListener('error', (e) => {
      const detail = (e as CustomEvent).detail;
      this.emit({
        type: 'status',
        status: 'error',
        detail: String((detail as Error)?.message ?? detail),
      });
    });

    client.addEventListener('message', (e) => {
      const { message } = (e as CustomEvent).detail as { message: irc.Message };
      this.handleMessage(message);
    });
  }

  disconnect() {
    if (this.client) {
      this.client.autoReconnect = false;
      this.client.disconnect();
      this.client = null;
    }
  }

  private handleMessage(msg: irc.Message) {
    const from = msg.prefix?.name ?? '';
    switch (msg.command) {
      case 'JOIN': {
        const channel = msg.params[0];
        if (this.client!.isMyNick(from)) {
          this.joined = true;
          this.opts.channel = channel;
          this.opts.action = 'room';
          this.emit({ type: 'joined', channel });
          this.announceCharacter({ characterId: this.opts.characterId });
        } else {
          this.emit({ type: 'join', channel, nick: from });
          // Newcomers haven't seen our character yet.
          this.announceCharacter({ characterId: this.opts.characterId });
        }
        break;
      }
      case 'PART':
      case 'QUIT':
        this.emit({
          type: 'part',
          channel: msg.command === 'PART' ? msg.params[0] : this.opts.channel,
          nick: from,
          reason: msg.params[msg.params.length - 1],
        });
        break;
      case 'NICK':
        this.emit({ type: 'nick', oldNick: from, newNick: msg.params[0] });
        break;
      case irc.RPL_NAMREPLY: {
        const channel = msg.params[msg.params.length - 2];
        const nicks = msg.params[msg.params.length - 1]
          .split(' ')
          .filter(Boolean)
          .map((n) => n.replace(/^[~&@%+]+/, ''));
        this.emit({ type: 'members', channel, nicks });
        break;
      }
      case 'PRIVMSG':
      case 'NOTICE':
        this.handleChatLine(from, msg);
        break;
      case 'TOPIC':
        this.emit({ type: 'topic', channel: msg.params[0], topic: msg.params[1] ?? '' });
        break;
      case '332': // RPL_TOPIC
        this.emit({ type: 'topic', channel: msg.params[1], topic: msg.params[2] ?? '' });
        break;
      case '321': // RPL_LISTSTART
        this.roomList = [];
        break;
      case '322': // RPL_LIST
        this.roomList.push({
          name: msg.params[1],
          users: parseInt(msg.params[2] ?? '0', 10),
          topic: msg.params[3] ?? '',
        });
        break;
      case '323': // RPL_LISTEND
        this.emit({ type: 'roomlist', rooms: this.roomList });
        break;
      case '311': // RPL_WHOISUSER: nick user host * :realname
        this.emit({
          type: 'identity',
          nick: msg.params[1],
          text: `${msg.params[1]} is ${msg.params[1]}!${msg.params[2]}@${msg.params[3]}\nReal name: ${msg.params[5] ?? ''}`,
        });
        break;
      case '312': // RPL_WHOISSERVER
        this.emit({
          type: 'info',
          text: `${msg.params[1]} is on server ${msg.params[2]} (${msg.params[3] ?? ''})`,
        });
        break;
      case '301': // RPL_AWAY
        this.emit({ type: 'info', text: `${msg.params[1]} is away: ${msg.params[2] ?? ''}` });
        break;
      case '306': // RPL_NOWAWAY
        this.emit({ type: 'info', text: 'You have been marked as being away.' });
        break;
      case '305': // RPL_UNAWAY
        this.emit({ type: 'info', text: 'You are no longer marked as being away.' });
        break;
      case '341': // RPL_INVITING
        this.emit({ type: 'info', text: `Invited ${msg.params[1]} to ${msg.params[2]}.` });
        break;
      case 'INVITE':
        this.emit({ type: 'info', text: `${from} invites you to ${msg.params[1]}.` });
        break;
      case '372': // RPL_MOTD
        this.motdLines.push(msg.params[msg.params.length - 1] ?? '');
        break;
      case '375': // RPL_MOTDSTART
        this.motdLines = [];
        break;
      case '376': // RPL_ENDOFMOTD
        this.emit({ type: 'motd', text: this.motdLines.join('\n') });
        break;
      case 'KICK':
        this.emit({
          type: 'info',
          text: `${from} kicked ${msg.params[1]} from ${msg.params[0]} (${msg.params[2] ?? ''})`,
        });
        this.emit({ type: 'part', channel: msg.params[0], nick: msg.params[1], reason: 'kicked' });
        break;
    }
  }

  private handleChatLine(from: string, msg: irc.Message) {
    // We echo our own messages locally at send time; drop server echoes
    // (echo-message capability) to avoid duplicate panels.
    if (this.client!.isMyNick(from)) return;
    const target = msg.params[0];
    let text = msg.params[1] ?? '';
    const isPrivate = !this.client!.isChannel(target);
    let kind: BalloonKind = isPrivate ? 'whisper' : 'say';
    let cc: CCMeta | null = null;

    // Comic annotation may wrap a CTCP ACTION; parse it first.
    const decoded = parseAnnotation(text, isPrivate);
    if (decoded) {
      text = decoded.text;
      kind = decoded.kind;
      cc = decoded.cc;
    }

    // CTCP ACTION (possibly after the annotation)
    const ctcpMatch = text.match(/^\x01ACTION ([^]*)\x01?$/);
    if (ctcpMatch) {
      kind = 'action';
      text = ctcpMatch[1];
    } else if (text.startsWith('\x01')) {
      this.handleCtcp(from, msg.command, text);
      return;
    }

    // '#' commands (character announce, background, info)
    const hash = parseHashCommand(text);
    if (hash) {
      switch (hash.type) {
        case 'appears':
          this.emit({
            type: 'message',
            msg: {
              from,
              target,
              kind: 'say',
              text: '',
              cc: {
                characterId: hash.character.toLowerCase(),
                characterUrl: hash.url ?? undefined,
              },
              self: this.client!.isMyNick(from),
              time: Date.now(),
            },
          });
          return;
        case 'getchar':
          this.sendRaw(from, buildAppearsAs(this.opts.characterId));
          return;
        case 'getinfo':
          this.sendRaw(from, buildHeresInfo(this.profile));
          return;
        case 'heresinfo':
          this.emit({ type: 'profile', nick: from, text: hash.profile });
          return;
        case 'bdrop':
          this.emit({ type: 'background', backgroundId: hash.background.toLowerCase(), from });
          return;
      }
    }

    if (msg.command === 'NOTICE' && !decoded) return; // server noise
    if (!text) return;

    this.emit({
      type: 'message',
      msg: { from, target, kind, text, cc, self: this.client!.isMyNick(from), time: Date.now() },
    });
  }

  private handleCtcp(from: string, command: string, text: string) {
    const m = text.match(/^\x01(\S+)(?: ([^]*?))?\x01?$/);
    if (!m) return;
    const [, ctcp, param = ''] = m;
    if (command === 'PRIVMSG') {
      // queries → NOTICE replies, like the original ReplyVersion/ReplyPing/ReplyTime
      switch (ctcp) {
        case 'VERSION':
          this.client?.send({
            command: 'NOTICE',
            params: [from, `\x01VERSION ${VERSION_REPLY}\x01`],
          });
          break;
        case 'PING':
          this.client?.send({ command: 'NOTICE', params: [from, `\x01PING ${param}\x01`] });
          break;
        case 'TIME':
          this.client?.send({
            command: 'NOTICE',
            params: [from, `\x01TIME ${new Date().toString()}\x01`],
          });
          break;
      }
    } else {
      // NOTICE = reply to our query
      switch (ctcp) {
        case 'VERSION':
          this.emit({ type: 'info', text: `${from} is using: ${param}` });
          break;
        case 'PING': {
          const sent = this.pendingPings.get(from.toLowerCase());
          if (sent) {
            this.pendingPings.delete(from.toLowerCase());
            this.emit({
              type: 'info',
              text: `Lag time to ${from}: ${((Date.now() - sent) / 1000).toFixed(2)} seconds.`,
            });
          }
          break;
        }
        case 'TIME':
          this.emit({ type: 'info', text: `Local time for ${from}: ${param}` });
          break;
      }
    }
  }

  private sendRaw(target: string, line: string) {
    this.client?.send({ command: 'PRIVMSG', params: [target, line] });
  }

  // -- member/room commands --------------------------------------------------

  joinRoom(channel: string) {
    if (!this.client) return;
    if (this.joined && this.opts.channel !== channel) {
      this.client.send({ command: 'PART', params: [this.opts.channel] });
      this.joined = false;
    }
    this.opts.channel = channel;
    this.client.send({ command: 'JOIN', params: [channel] });
  }

  leaveRoom() {
    if (!this.client || !this.joined) return;
    this.client.send({ command: 'PART', params: [this.opts.channel] });
    this.joined = false;
  }

  requestRoomList() {
    this.client?.send({ command: 'LIST', params: [] });
  }

  requestProfile(nick: string) {
    this.sendRaw(nick, '# GetInfo');
  }

  requestCharacter(nick: string) {
    this.sendRaw(nick, buildGetCharInfo());
  }

  requestIdentity(nick: string) {
    this.client?.send({ command: 'WHOIS', params: [nick] });
  }

  requestVersion(nick: string) {
    this.sendRaw(nick, '\x01VERSION\x01');
  }

  requestLagTime(nick: string) {
    this.pendingPings.set(nick.toLowerCase(), Date.now());
    this.sendRaw(nick, `\x01PING ${Date.now()}\x01`);
  }

  requestLocalTime(nick: string) {
    this.sendRaw(nick, '\x01TIME\x01');
  }

  requestMotd() {
    this.client?.send({ command: 'MOTD', params: [] });
  }

  setAway(away: boolean, message?: string) {
    this.client?.send({ command: 'AWAY', params: away ? [message || 'Away from keyboard'] : [] });
  }

  invite(nick: string) {
    this.client?.send({ command: 'INVITE', params: [nick, this.opts.channel] });
  }

  setTopic(topic: string) {
    this.client?.send({ command: 'TOPIC', params: [this.opts.channel, topic] });
  }

  announceBackground(backgroundId: string) {
    if (this.joined) this.sendRaw(this.opts.channel, buildBDrop(backgroundId));
  }

  sendMessage(kind: BalloonKind, text: string, cc: CCMeta, whisperTo?: string) {
    if (!this.client) return;
    const target = whisperTo ?? this.opts.channel;
    const pose: OutgoingPose = {
      faceIndex: cc.faceIndex ?? -1,
      torsoIndex: cc.torsoIndex ?? -1,
      faceEmotionIndex: cc.emotionIndex ?? 9,
      faceIntensity: cc.intensity ?? 0,
      torsoEmotionIndex: cc.torsoEmotionIndex ?? 9,
      torsoIntensity: cc.torsoIntensity ?? 0,
      requested: !!cc.requested,
    };
    const ann = buildAnnotation(kind, pose, cc.talkTos ?? []);
    const body = kind === 'action' ? `\x01ACTION ${text}\x01` : text;
    this.client.send({ command: 'PRIVMSG', params: [target, ann + body] });
    // Local echo (no dependence on echo-message cap).
    this.emit({
      type: 'message',
      msg: { from: this.nick, target, kind, text, cc, self: true, time: Date.now() },
    });
  }

  announceCharacter(cc: CCMeta) {
    if (!this.client || !this.joined) return;
    if (cc.characterId) {
      this.sendRaw(this.opts.channel, buildAppearsAs(cc.characterId, cc.characterUrl));
    }
  }
}
