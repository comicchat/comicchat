// Avatar engine: pose selection and head/torso composition.
// Direct port of avatar.cpp (CAvatarComplex/CAvatarSimple/CBodyDouble).

import type { Character, LoadedPose } from '../art/store';
import type { Emotion } from '../art/types';
import { EM, EMOTION_FLOATS } from '../art/types';

const NEMOTIONS = 8;

/** vector2d.cpp value_to_angle: normalize into (-PI, PI]. */
export function subtractAngles(a1: number, a2: number): number {
  let v = a1 - a2;
  if (v > -Math.PI && v <= Math.PI) return v;
  v = v % (2 * Math.PI);
  if (v < 0) v += 2 * Math.PI;    // C fmod keeps sign; emulate lisp mod
  return v <= Math.PI ? v : v - 2 * Math.PI;
}

/** CEmotionOpts: candidate emotions with priorities (semantic engine output). */
export interface EmotionOpt {
  emotion: number;
  intensity: number;
  priority: number;
}

export const OVERRIDEBYPRIORITY = 1;
export const ADDPRIORITY = 2;

export class EmotionOpts {
  opts: EmotionOpt[] = [];

  /** CEmotionOpts::Add — exact port from avatar.cpp:725. */
  add(emotion: number, intensity: number, priority: number, flags = OVERRIDEBYPRIORITY) {
    for (const o of this.opts) {
      if (o.emotion === emotion) {
        if (flags & OVERRIDEBYPRIORITY) {
          if (o.priority < priority) {
            o.priority = priority;
            o.intensity = intensity;
          }
          return;
        } else if (flags & ADDPRIORITY) {
          // (sic: the original uses max(x+p, 255), pinning to 255)
          o.priority = Math.max(o.priority + priority, 255);
          o.intensity = Math.max(o.intensity, intensity);
          return;
        }
      }
    }
    if (this.opts.length >= 10) return;
    this.opts.push({ emotion, intensity, priority });
  }
}

/** A chosen body: indices into the face/torso (or body) record arrays. */
export interface ChosenBody {
  faceIndex: number;  // complex only (-1 for simple)
  torsoIndex: number; // complex: torso index; simple: body index
}

/** Per-character mutable pose state (m_lastFace/m_lastTorso/m_lastBody). */
export class AvatarState {
  char: Character;
  lastFace = -1;
  lastTorso = -1;
  body: ChosenBody;
  flip = false;
  /** AF_FROZEN: a frozen avatar keeps its pose instead of resetting to
   *  neutral after each line. */
  frozen = false;

  constructor(char: Character) {
    this.char = char;
    this.body = this.neutralBody();
  }

  get isComplex() { return this.char.isComplex; }

  private recEmotion(rec: { emotionIndex: number }): number {
    return EMOTION_FLOATS[rec.emotionIndex] ?? 0;
  }

  neutralBody(): ChosenBody {
    if (this.isComplex) {
      return { faceIndex: this.findNeutral('face'), torsoIndex: this.findNeutral('torso') };
    }
    return { faceIndex: -1, torsoIndex: this.findNeutral('body') };
  }

  private findNeutral(kind: 'face' | 'torso' | 'body'): number {
    const recs = kind === 'face' ? this.char.meta.faces
      : kind === 'torso' ? this.char.meta.torsos : this.char.meta.bodies;
    const last = kind === 'face' ? this.lastFace : this.lastTorso;
    const n = recs.length;
    if (n === 0) return -1;
    let c = last;
    for (let i = 0; i < n; i++) {
      c = (c + 1) % n;
      if (this.recEmotion(recs[c]) === EM.NEUTRAL && recs[c].intensity === 0) return c;
    }
    return 0;
  }

  /** CAvatarComplex::GetHeadAndBodyFromEmotion / CAvatarSimple::GetBodyIndexFromEmotion */
  headAndBodyFromEmotion(em: Emotion): { fIndex: number; tIndex: number } {
    let fIndex = -1, tIndex = -1;
    if (this.isComplex) {
      if (em.emotion <= 2 * Math.PI) {
        let nearestAngle = 3 * Math.PI;
        let intensityOfNearest = 2.0;
        const faces = this.char.meta.faces;
        for (let i = 0; i < faces.length; i++) {
          const thisAngle = Math.abs(subtractAngles(this.recEmotion(faces[i]), em.emotion));
          if (thisAngle <= nearestAngle) {
            const deltaI = Math.abs(em.intensity - faces[i].intensity);
            if (thisAngle === nearestAngle && deltaI >= intensityOfNearest) continue;
            nearestAngle = thisAngle;
            intensityOfNearest = deltaI;
            fIndex = i;
          }
        }
      } else {
        const torsos = this.char.meta.torsos;
        for (let i = 0; i < torsos.length; i++) {
          if (em.emotion === this.recEmotion(torsos[i])) { tIndex = i; break; }
        }
      }
    } else {
      const bodies = this.char.meta.bodies;
      if (em.emotion <= 2 * Math.PI) {
        let nearestAngle = 3 * Math.PI;
        let intensityOfNearest = 2.0;
        for (let i = 0; i < bodies.length; i++) {
          const thisAngle = Math.abs(subtractAngles(this.recEmotion(bodies[i]), em.emotion));
          if (thisAngle <= nearestAngle) {
            const deltaI = Math.abs(em.intensity - bodies[i].intensity);
            if (thisAngle === nearestAngle && deltaI >= intensityOfNearest) continue;
            nearestAngle = thisAngle;
            intensityOfNearest = deltaI;
            tIndex = i;
          }
        }
      } else {
        for (let i = 0; i < bodies.length; i++) {
          if (em.emotion === this.recEmotion(bodies[i])) { tIndex = i; break; }
        }
      }
    }
    return { fIndex, tIndex };
  }

  /** CAvatarX::GetBodyFromEmotion(CEmotionOpts&) — fill face/torso by priority. */
  bodyFromEmotionOpts(emOpts: EmotionOpts): ChosenBody {
    const opts = emOpts.opts.map((o) => ({ ...o }));
    let foundF = -1, foundT = -1;
    while (true) {
      let minPriority = 0, bestIndex = -1;
      for (let i = 0; i < opts.length; i++) {
        if (opts[i].priority > minPriority) {
          bestIndex = i;
          minPriority = opts[i].priority;
        }
      }
      if (!minPriority || bestIndex < 0) break;
      const { fIndex, tIndex } = this.headAndBodyFromEmotion(opts[bestIndex]);
      opts[bestIndex].priority = 0;
      if (this.isComplex) {
        if (fIndex >= 0 && foundF < 0) foundF = fIndex;
        if (tIndex >= 0 && foundT < 0) foundT = tIndex;
        if (foundF >= 0 && foundT >= 0) break;
      } else if (tIndex >= 0 && foundT < 0) {
        foundT = tIndex;
        break;
      }
    }
    if (this.isComplex) {
      if (foundF < 0) foundF = this.findNeutral('face');
      if (foundT < 0) foundT = this.findNeutral('torso');
      return { faceIndex: foundF, torsoIndex: foundT };
    }
    if (foundT < 0) foundT = this.findNeutral('body');
    return { faceIndex: -1, torsoIndex: foundT };
  }

  /** CAvatarComplex::GetBodyFromEmotion(CEmotion&) — single-emotion variant
   *  (used by the emotion wheel). Includes the torso rotation for variety. */
  bodyFromEmotion(em: Emotion): ChosenBody {
    if (this.isComplex) {
      let fIndex = -1;
      {
        let nearestAngle = 3 * Math.PI;
        let intensityOfNearest = 2.0;
        const faces = this.char.meta.faces;
        for (let i = 0; i < faces.length; i++) {
          const thisAngle = Math.abs(subtractAngles(this.recEmotion(faces[i]), em.emotion));
          if (thisAngle <= nearestAngle) {
            const deltaI = Math.abs(em.intensity - faces[i].intensity);
            if (thisAngle === nearestAngle && deltaI >= intensityOfNearest) continue;
            nearestAngle = thisAngle;
            intensityOfNearest = deltaI;
            fIndex = i;
          }
        }
      }
      let tIndex = -1;
      {
        let intensityOfNearest = 2.0;
        const torsos = this.char.meta.torsos;
        const n = torsos.length;
        for (let i = 0; i < n; i++) {
          const index = (this.lastTorso + 1 + i) % n;
          const recEm = this.recEmotion(torsos[index]);
          if (recEm > 7) continue; // skip gestures
          const thisAngle = Math.abs(subtractAngles(recEm, em.emotion));
          if (thisAngle < Math.PI / NEMOTIONS ||
              (recEm === EM.NEUTRAL && torsos[index].intensity === 0)) {
            const deltaI = Math.abs(em.intensity - torsos[index].intensity);
            if (deltaI < intensityOfNearest) {
              intensityOfNearest = deltaI;
              tIndex = index;
            }
          }
        }
        if (tIndex < 0) tIndex = this.findNeutral('torso');
      }
      return { faceIndex: fIndex, torsoIndex: tIndex };
    }

    // CAvatarSimple::GetBodyFromEmotion(CEmotion&)
    const bodies = this.char.meta.bodies;
    const n = bodies.length;
    let intensityOfNearest = 2.0;
    let nearestI = -1;
    for (let i = 0; i < n; i++) {
      const index = (this.lastTorso + 1 + i) % n;
      const recEm = this.recEmotion(bodies[index]);
      if (recEm > 7) continue;
      const thisAngle = Math.abs(subtractAngles(recEm, em.emotion));
      const isFirstNeutral = recEm === EM.NEUTRAL && bodies[index].intensity === 0 && nearestI === -1;
      if (thisAngle < Math.PI / NEMOTIONS || isFirstNeutral) {
        const deltaI = isFirstNeutral && em.intensity > 0
          ? 1.5
          : Math.abs(em.intensity - bodies[index].intensity);
        if (deltaI < intensityOfNearest) {
          intensityOfNearest = deltaI;
          nearestI = index;
        }
      }
    }
    if (nearestI < 0) nearestI = this.findNeutral('body');
    return { faceIndex: -1, torsoIndex: nearestI };
  }

  /** CAvatarX::RecordBody: remember what was used for rotation variety. */
  recordBody(body: ChosenBody) {
    this.body = body;
    if (this.isComplex) {
      this.lastFace = body.faceIndex;
      this.lastTorso = body.torsoIndex;
    } else {
      this.lastTorso = body.torsoIndex;
    }
  }

  /** CAvatarX::UpdateBody: adopt the body only if it differs (IsSame check).
   *  Note: does NOT advance the pose rotation — RecordBody happens only when
   *  a body is placed into a panel (FetchSpeaker/ReplaceBody), so repeated
   *  picks of the same emotion keep the same pose. */
  updateBody(body: ChosenBody): boolean {
    if (body.faceIndex === this.body.faceIndex && body.torsoIndex === this.body.torsoIndex) {
      return false;
    }
    this.body = body;
    return true;
  }

  /** CAvatarX::SetIndices — apply wire pose indices. */
  setIndices(faceIndex: number, torsoIndex: number) {
    const b = { ...this.body };
    if (this.isComplex) {
      if (faceIndex >= 0 && faceIndex < this.char.meta.faces.length) b.faceIndex = faceIndex;
      if (torsoIndex >= 0 && torsoIndex < this.char.meta.torsos.length) b.torsoIndex = torsoIndex;
    } else if (torsoIndex >= 0 && torsoIndex < this.char.meta.bodies.length) {
      b.torsoIndex = torsoIndex;
    }
    this.body = b;
  }

  /** CAvatarX::SetEmotions — OTHERMAPPED fallback: pick poses from emotions. */
  setEmotions(face: Emotion, torso: Emotion) {
    if (this.isComplex) {
      const f = this.headAndBodyPublic(face);
      const t = this.headAndBodyPublic(torso);
      this.body = {
        faceIndex: f.fIndex >= 0 ? f.fIndex : this.findNeutral('face'),
        torsoIndex: t.tIndex >= 0 ? t.tIndex : (f.tIndex >= 0 ? f.tIndex : this.findNeutral('torso')),
      };
    } else {
      const t = this.headAndBodyPublic(torso);
      this.body = { faceIndex: -1, torsoIndex: t.tIndex >= 0 ? t.tIndex : this.findNeutral('body') };
    }
  }

  /** GetIndices equivalent for the outgoing wire. */
  getIndices(): { faceIndex: number; torsoIndex: number } {
    return { faceIndex: this.body.faceIndex, torsoIndex: this.body.torsoIndex };
  }

  /** Emotions of the current body records (GetEmotions). */
  getEmotions(): { face: Emotion; torso: Emotion } {
    const meta = this.char.meta;
    if (this.isComplex) {
      const f = meta.faces[this.body.faceIndex];
      const t = meta.torsos[this.body.torsoIndex];
      return {
        face: f ? this.char.emotionOf(f) : { emotion: 0, intensity: 0 },
        torso: t ? this.char.emotionOf(t) : { emotion: 0, intensity: 0 },
      };
    }
    const b = meta.bodies[this.body.torsoIndex];
    const em = b ? this.char.emotionOf(b) : { emotion: 0, intensity: 0 };
    return { face: em, torso: em };
  }

  private headAndBodyPublic(em: Emotion) {
    return this.headAndBodyFromEmotion(em);
  }
}

/** Synchronous geometry for panel layout — requires the character's poses to
 *  be preloaded (Character.preload()). */
export function computeBodyGeometrySync(
  state: AvatarState,
  body: ChosenBody,
  flip: boolean,
): BodyGeometry | null {
  const meta = state.char.meta;
  if (state.isComplex) {
    const face = meta.faces[body.faceIndex];
    const torso = meta.torsos[body.torsoIndex];
    if (!face || !torso) return null;
    const head = state.char.poseSync(face.pose);
    const tors = state.char.poseSync(torso.pose);
    if (!head || !tors) return null;

    const xOffset = torso.cx + face.cxDelta - face.cx;
    const yOffset = torso.cy + face.cyDelta - face.cy;
    const left = Math.min(0, xOffset);
    const right = Math.max(tors.w, xOffset + head.w);
    const top = Math.min(0, yOffset);
    let headHeight = yOffset + head.h;
    const bottom = Math.max(tors.h, headHeight);
    const width = right - left;
    const height = bottom - top;
    headHeight -= top;
    let faceX = (face.x & 0xff) + xOffset - left;
    const faceY = (face.y & 0xff) + yOffset - top;
    if (flip) faceX = width - faceX;

    return {
      width, height, headHeight, faceX, faceY,
      headPos: { x: xOffset - left, y: yOffset - top },
      torsoPos: { x: -left, y: -top },
      headPose: head,
      torsoPose: tors,
    };
  }

  const rec = meta.bodies[body.torsoIndex];
  if (!rec) return null;
  const pose = state.char.poseSync(rec.pose);
  if (!pose) return null;
  let faceX = rec.x & 0xff;
  if (flip) faceX = pose.w - faceX;
  return {
    width: pose.w,
    height: pose.h,
    headHeight: Math.floor(pose.h / 2),
    faceX,
    faceY: rec.y & 0xff,
    headPos: null,
    torsoPos: { x: 0, y: 0 },
    headPose: null,
    torsoPose: pose,
  };
}

/** Composite geometry for a chosen body (CBodyDouble::GetBodyBox port). */
export interface BodyGeometry {
  width: number;
  height: number;
  headHeight: number;       // bottom edge of the head within the composite
  faceX: number;            // face center x within the composite (after flip)
  faceY: number;            // face center y within the composite
  // draw positions (y-down, relative to composite top-left):
  headPos: { x: number; y: number } | null;
  torsoPos: { x: number; y: number };
  headPose: LoadedPose | null;
  torsoPose: LoadedPose;
}

export async function computeBodyGeometry(
  state: AvatarState,
  body: ChosenBody,
  flip: boolean,
): Promise<BodyGeometry | null> {
  const meta = state.char.meta;
  if (state.isComplex) {
    const face = meta.faces[body.faceIndex];
    const torso = meta.torsos[body.torsoIndex];
    if (!face || !torso) return null;
    const headPose = await state.char.pose(face.pose);
    const torsoPose = await state.char.pose(torso.pose);
    if (!headPose || !torsoPose) return null;
    const head = await headPose;
    const tors = await torsoPose;

    // CBodyDouble::GetDimInfo
    const xOffset = torso.cx + face.cxDelta - face.cx;
    const yOffset = torso.cy + face.cyDelta - face.cy;
    const left = Math.min(0, xOffset);
    const right = Math.max(tors.w, xOffset + head.w);
    const top = Math.min(0, yOffset);
    let headHeight = yOffset + head.h;
    const bottom = Math.max(tors.h, headHeight);
    const width = right - left;
    const height = bottom - top;
    headHeight -= top;
    let faceX = (face.x & 0xff) + xOffset - left;
    const faceY = (face.y & 0xff) + yOffset - top;
    if (flip) faceX = width - faceX;

    return {
      width, height, headHeight,
      faceX, faceY,
      headPos: { x: xOffset - left, y: yOffset - top },
      torsoPos: { x: -left, y: -top },
      headPose: head,
      torsoPose: tors,
    };
  }

  const rec = meta.bodies[body.torsoIndex];
  if (!rec) return null;
  const posePromise = state.char.pose(rec.pose);
  if (!posePromise) return null;
  const pose = await posePromise;
  let faceX = rec.x & 0xff;
  if (flip) faceX = pose.w - faceX;
  return {
    width: pose.w,
    height: pose.h,
    headHeight: Math.floor(pose.h / 2),
    faceX,
    faceY: rec.y & 0xff,
    headPos: null,
    torsoPos: { x: 0, y: 0 },
    headPose: null,
    torsoPose: pose,
  };
}

/** Draw a body into a canvas context at (x, y) scaled by `scale`.
 *  Flip mirrors horizontally around the composite box. */
export function drawBody(
  ctx: CanvasRenderingContext2D,
  geo: BodyGeometry,
  x: number,
  y: number,
  scale: number,
  flip: boolean,
  torsoFirst = true,
) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  if (flip) {
    ctx.translate(geo.width, 0);
    ctx.scale(-1, 1);
  }
  const drawTorso = () => ctx.drawImage(geo.torsoPose.img, geo.torsoPos.x, geo.torsoPos.y);
  const drawHead = () => {
    if (geo.headPose && geo.headPos) ctx.drawImage(geo.headPose.img, geo.headPos.x, geo.headPos.y);
  };
  if (torsoFirst) { drawTorso(); drawHead(); }
  else { drawHead(); drawTorso(); }
  ctx.restore();
}
