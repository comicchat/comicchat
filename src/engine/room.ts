// Room state: members, their avatars, and avatar auto-assignment for plain
// IRC users (GetAvatar3 with bRandomIfNotFound in the original).

import type { ArtStore, Character } from '../art/store';
import { AvatarState } from './avatar';

export interface Member {
  nick: string;
  characterId: string | null; // null until known/assigned
  avatar: AvatarState | null;
  explicit: boolean;          // character came from the wire (vs auto-assigned)
  /** True when the announced character wasn't available locally and we
   *  substituted another (avatar.h OTHERMAPPED): wire pose indices don't
   *  apply, emotions do. */
  otherMapped: boolean;
  talkTos: string[];          // member keys this member last addressed
  isComicUser: boolean;       // has sent comic metadata
}

export class Room {
  art: ArtStore;
  channel = '';
  members = new Map<string, Member>(); // key: lowercased nick
  onRosterChange: () => void = () => {};
  /** Characters eligible for auto-assignment (B/W roster). */
  eligibleCharacterIds: string[] = [];
  private avatarQueue = new Map<string, Promise<Member>>();

  constructor(art: ArtStore) {
    this.art = art;
  }

  private key(nick: string) { return nick.toLowerCase(); }

  member(nick: string): Member | undefined {
    return this.members.get(this.key(nick));
  }

  addMember(nick: string): Member {
    let m = this.members.get(this.key(nick));
    if (!m) {
      m = {
        nick, characterId: null, avatar: null, explicit: false,
        otherMapped: false, talkTos: [], isComicUser: false,
      };
      this.members.set(this.key(nick), m);
      this.onRosterChange();
    }
    return m;
  }

  removeMember(nick: string) {
    if (this.members.delete(this.key(nick))) this.onRosterChange();
  }

  renameMember(oldNick: string, newNick: string) {
    const m = this.members.get(this.key(oldNick));
    if (m) {
      this.members.delete(this.key(oldNick));
      m.nick = newNick;
      this.members.set(this.key(newNick), m);
      this.onRosterChange();
    }
  }

  clear() {
    this.members.clear();
    this.onRosterChange();
  }

  /** Deterministic auto-assignment for members with no announced character. */
  private autoAssignId(nick: string): string {
    const ids = this.eligibleCharacterIds.length
      ? this.eligibleCharacterIds
      : this.art.characterIds();
    let h = 0;
    const k = this.key(nick);
    for (let i = 0; i < k.length; i++) h = (h * 31 + k.charCodeAt(i)) >>> 0;
    return ids[h % ids.length];
  }

  /** Ensure a member has a Character bound, loading art as needed.
   *  Serialized per member so roster auto-assign and 'Appears as' announces
   *  can't race each other. */
  ensureAvatar(nick: string, announcedId?: string | null): Promise<Member> {
    const key = this.key(nick);
    const prev = this.avatarQueue.get(key) ?? Promise.resolve(undefined as unknown as Member);
    const next = prev.then(() => this.ensureAvatarInner(nick, announcedId));
    this.avatarQueue.set(key, next.catch(() => this.addMember(nick)));
    return next;
  }

  private async ensureAvatarInner(nick: string, announcedId?: string | null): Promise<Member> {
    const m = this.addMember(nick);
    // An explicit announcement wins over auto-assignment, and a repeat
    // auto-assign never overrides an explicit character.
    if (m.explicit && !announcedId) {
      if (m.avatar) return m;
    }
    const wantId = announcedId ?? m.characterId ?? this.autoAssignId(nick);
    const changed = m.characterId !== wantId;
    if (announcedId) m.explicit = true;
    if (changed || !m.avatar) {
      m.characterId = wantId;
      m.otherMapped = false;
      let char: Character;
      try {
        char = await this.art.character(wantId);
      } catch {
        // Unknown character announced (e.g. custom .avb we don't have):
        // substitute one (OTHERMAPPED) like the original's GetAvatar3.
        m.characterId = this.autoAssignId(nick);
        m.otherMapped = true;
        char = await this.art.character(m.characterId);
      }
      await char.preload();
      m.avatar = new AvatarState(char);
      this.onRosterChange();
    }
    return m;
  }
}
