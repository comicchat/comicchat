// Comic Chat wire protocol — faithful port of the original annotation format
// (protsupp.cpp bInsertAnnotations/ProcessSay/ProcessComment, ircproto.h).
//
// Outgoing channel message (non-IRCX servers):
//   PRIVMSG #room :(#G<t><te><ti>E<f><fe><fi>[R]M<m>[T<nicks>]) <text>
// where every value is encoded as value + '0' (printable ASCII).
//   G: torso index, torso emotion index (emFloats), torso intensity (0-10)
//   E: face index, face emotion index, face intensity
//   R: present if the user explicitly requested the emotion (wheel pinned)
//   M: send mode — SM_SAY=1, SM_WHISPER=2, SM_THINK=3, SM_ACTION=5
//   T: comma-separated addressee nicks
//
// '#'-commands (message text starts with '#'):
//   "# Appears as <char>[, <url>]"   announce character
//   "# GetCharInfo"                  request the sender's character
//   "# GetInfo" / "# HeresInfo: .."  profile exchange
//   "# BDrop: <name>" / "# BDrop2: <name>[, <url>]"  room background (ops)

import type { BalloonKind, CCMeta } from './session';

const SM_SAY = 1;
const SM_WHISPER = 2;
const SM_THINK = 3;
const SM_ACTION = 5;

const APPEARS_PREFIX = ' Appears as ';
const GETINFO_PREFIX = ' GetInfo';
const HERESINFO_PREFIX = ' HeresInfo: ';
const BDROP_PREFIX = ' BDrop: ';
const BDROP2_PREFIX = ' BDrop2: ';
const REQUESTCHAR_PREFIX = ' GetCharInfo';

const enc = (v: number) => String.fromCharCode(v + 0x30); // IndexToByte
const dec = (c: string) => c.charCodeAt(0) - 0x30;        // ByteToIndex

function kindToMode(kind: BalloonKind): number {
  switch (kind) {
    case 'whisper': return SM_WHISPER;
    case 'think': return SM_THINK;
    case 'action': return SM_ACTION;
    default: return SM_SAY;
  }
}

function modeToKind(mode: number): BalloonKind {
  switch (mode) {
    case SM_WHISPER: return 'whisper';
    case SM_THINK: return 'think';
    case SM_ACTION: return 'action';
    default: return 'say';
  }
}

/** Pose/emotion state to encode with an outgoing message. */
export interface OutgoingPose {
  faceIndex: number;   // -1 if none
  torsoIndex: number;  // -1 if none
  faceEmotionIndex: number;   // emFloats index (9 = neutral)
  faceIntensity: number;      // 0..1
  torsoEmotionIndex: number;
  torsoIntensity: number;     // 0..1
  requested: boolean;
}

export function buildAnnotation(kind: BalloonKind, pose: OutgoingPose, talkTos: string[] = []): string {
  let s = '(#';
  s += 'G' + enc(pose.torsoIndex) + enc(pose.torsoEmotionIndex) + enc(Math.floor(pose.torsoIntensity * 10));
  s += 'E' + enc(pose.faceIndex) + enc(pose.faceEmotionIndex) + enc(Math.floor(pose.faceIntensity * 10));
  if (pose.requested) s += 'R';
  s += 'M' + enc(kindToMode(kind));
  if (talkTos.length) s += 'T' + talkTos.join(',');
  s += ') ';
  return s;
}

export interface ParsedAnnotation {
  text: string;
  kind: BalloonKind;
  cc: CCMeta;
}

/** Parse "(#G..E..[R]M..[T..]) text" — ProcessSay's embedded-annotation path. */
export function parseAnnotation(msg: string, isPrivate: boolean): ParsedAnnotation | null {
  if (!msg.startsWith('(#') || !msg.slice(2).includes(') ')) return null;
  let i = 2;
  const cc: CCMeta = {};
  let gestI = -1, exprI = -1;
  let mode = SM_SAY;

  if (msg[i] === 'G') {
    i++;
    if (msg[i]) cc.torsoIndex = dec(msg[i++]);
    if (msg[i]) cc.torsoEmotionIndex = dec(msg[i++]);
    if (msg[i]) { gestI = dec(msg[i++]); cc.torsoIntensity = gestI / 10; }
  }
  if (msg[i] === 'E') {
    i++;
    if (msg[i]) cc.faceIndex = dec(msg[i++]);
    if (msg[i]) cc.emotionIndex = dec(msg[i++]);
    if (msg[i]) { exprI = dec(msg[i++]); cc.intensity = exprI / 10; }
  }
  if (msg[i] === 'R') {
    i++;
    cc.requested = true;
  }
  if (msg[i] === 'M') {
    i++;
    if (msg[i]) mode = dec(msg[i++]);
    if (isPrivate) mode = SM_WHISPER; // anti-hacker line from the original
  }
  if (msg[i] === 'T') {
    const end = msg.indexOf(') ', i);
    cc.talkTos = msg.slice(i + 1, end < 0 ? undefined : end).split(',').filter(Boolean);
  }

  const close = msg.indexOf(') ', i);
  if (close < 0 || gestI === -1 || exprI === -1) return null; // not "cooked"
  return {
    text: msg.slice(close + 2),
    kind: modeToKind(mode),
    cc,
  };
}

// -- '#' commands ------------------------------------------------------------

export type HashCommand =
  | { type: 'appears'; character: string; url: string | null }
  | { type: 'getinfo' }
  | { type: 'getchar' }
  | { type: 'heresinfo'; profile: string }
  | { type: 'bdrop'; background: string; url: string | null };

export function buildAppearsAs(character: string, url?: string | null): string {
  return `#${APPEARS_PREFIX}${character}${url ? `, ${url}` : ''}`;
}

export function buildGetCharInfo(): string {
  return `#${REQUESTCHAR_PREFIX}`;
}

export function buildHeresInfo(profile: string): string {
  return `#${HERESINFO_PREFIX}${profile}`;
}

export function buildBDrop(background: string, url?: string | null): string {
  return `#${BDROP2_PREFIX}${background}${url ? `, ${url}` : ''}`;
}

/** Parse a '#'-command message (ProcessComment). Returns null if not one. */
export function parseHashCommand(msg: string): HashCommand | null {
  if (!msg.startsWith('#')) return null;
  const body = msg.slice(1);
  if (body.startsWith(APPEARS_PREFIX)) {
    const rest = body.slice(APPEARS_PREFIX.length);
    // GetToken with separators ",.)" — name runs until ',' / '.' / ')'
    const m = rest.match(/^\s*([^,.)]+)\s*(?:,\s*([^,)]*))?/);
    if (!m) return null;
    const url = m[2]?.trim();
    return {
      type: 'appears',
      character: m[1].trim(),
      url: url && url !== '?' ? url : null,
    };
  }
  if (body.startsWith(HERESINFO_PREFIX)) {
    return { type: 'heresinfo', profile: body.slice(HERESINFO_PREFIX.length) };
  }
  if (body.startsWith(REQUESTCHAR_PREFIX)) return { type: 'getchar' };
  if (body.startsWith(GETINFO_PREFIX)) return { type: 'getinfo' };
  if (body.startsWith(BDROP2_PREFIX) || body.startsWith(BDROP_PREFIX)) {
    const isV2 = body.startsWith(BDROP2_PREFIX);
    const rest = body.slice((isV2 ? BDROP2_PREFIX : BDROP_PREFIX).length).trim();
    if (!rest) return null;
    const m = rest.match(/^([^,)]+)\s*(?:,\s*([^,)]*))?/);
    if (!m) return null;
    const name = m[1].trim().replace(/\.[^.]*$/, ''); // original strips extension
    return { type: 'bdrop', background: name, url: m[2]?.trim() || null };
  }
  return null;
}
