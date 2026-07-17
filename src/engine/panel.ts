// Panel engine — faithful port of panel.cpp (CUnitPanel, CPanel,
// OrderAvatars/EvalPair greedy placement, LayoutBalloons negotiation).
// All coordinates in twips, y-up: panel spans (0,0)..(unitWidth,-unitHeight).

import { Balloon } from './balloon';
import { computeBodyGeometrySync, type AvatarState, type ChosenBody } from './avatar';
import { MsvcRand, globalRand } from './rand';
import {
  MAX_PANEL_BODIES,
  MINHOOKHEIGHT,
  ONELINETHRESHOLD,
  PANEL_BORDER_WIDTH,
  TOPBORDER,
  YBORDER,
  HWAVEHEIGHT,
  DOCK_SNAP,
  type SRect,
} from './twips';

export interface PanelBodyState {
  memberKey: string;
  nick: string;
  avatar: AvatarState;
  body: ChosenBody;
  flip: boolean;
  requested: boolean;
  // set by layoutAvatars:
  bbox: SRect;
  arrowX: number;
  scale: number; // twips per art pixel
}

/** Hysteresis state per member (CAvatarX m_lastDir/m_lastLeft/m_lastRight). */
export interface Hysteresis {
  lastDir: boolean;
  lastLeft: string | null;
  lastRight: string | null;
}

export interface PanelContext {
  unitWidth: number;
  unitHeight: number;
  hysteresis: (memberKey: string) => Hysteresis;
  talkTos: (memberKey: string) => string[]; // member keys
  avatarOf: (memberKey: string) => AvatarState | null;
  nickOf: (memberKey: string) => string;
}

const BR_SPEAKER = 0;
const BR_GOODIDEA = 1;

export class Panel {
  seed: number;
  backgroundId: string | null;
  bodies: PanelBodyState[] = [];
  balloons: Balloon[] = [];
  hasBorder = true;
  /** zoom applied to the backdrop box (AdjustArtToCoord) */
  backdropBox: SRect | null = null;
  zoomFixedY = 0;
  zoomFactor = 1;

  constructor(backgroundId: string | null, seed?: number) {
    this.backgroundId = backgroundId;
    this.seed = seed ?? globalRand.rand();
  }

  clone(): Panel {
    const p = new Panel(this.backgroundId, this.seed);
    p.hasBorder = this.hasBorder;
    for (const b of this.bodies) {
      p.bodies.push({ ...b, bbox: { ...b.bbox }, body: { ...b.body } });
    }
    for (const bal of this.balloons) {
      const nb = new Balloon(bal.type, bal.segments, bal.font);
      const idx = this.bodies.findIndex((bd) => bd.memberKey === bal.speaker?.key);
      if (idx >= 0) {
        const body = p.bodies[idx];
        nb.speaker = { arrowX: body.arrowX, bboxTop: body.bbox.top, key: body.memberKey };
      }
      p.balloons.push(nb);
    }
    return p;
  }

  hasMember(key: string): boolean {
    return this.bodies.some((b) => b.memberKey === key);
  }

  fetchSpeaker(key: string, ctx: PanelContext): PanelBodyState {
    let b = this.bodies.find((bd) => bd.memberKey === key);
    if (b) return b;
    const avatar = ctx.avatarOf(key)!;
    avatar.recordBody({ ...avatar.body }); // FetchSpeaker records (rotation advances)
    b = {
      memberKey: key,
      nick: ctx.nickOf(key),
      avatar,
      body: { ...avatar.body },
      flip: false,
      requested: true,
      bbox: { left: 0, bottom: 0, right: 0, top: 0 },
      arrowX: 0,
      scale: 1,
    };
    this.bodies.push(b);
    return b;
  }

  replaceBody(key: string, ctx: PanelContext): boolean {
    const b = this.bodies.find((bd) => bd.memberKey === key);
    if (!b) return false;
    const avatar = ctx.avatarOf(key);
    if (!avatar) return false;
    avatar.recordBody({ ...avatar.body }); // ReplaceBody records too
    b.body = { ...avatar.body };
    b.requested = true;
    return true;
  }

  /** CUnitPanel::IsSpeaker */
  private isSpeaker(b: PanelBodyState): boolean {
    if (b.requested) return true;
    return this.balloons.some((bal) => bal.speaker?.key === b.memberKey);
  }

  // -------------------------------------------------------------------------
  // LayoutAvatars

  layoutAvatars(ctx: PanelContext, establishing: boolean) {
    interface Rec {
      body: PanelBodyState;
      priority: number;
    }
    const recs: Rec[] = [];
    for (const b of this.bodies) {
      if (this.isSpeaker(b)) recs.push({ body: b, priority: BR_SPEAKER });
      // non-speakers dropped (original deletes them)
    }
    this.bodies = [];
    if (recs.length === 0) return;

    // AddTalkTos: pull in listeners (max 5 total in panel)
    if (recs.length < MAX_PANEL_BODIES) {
      const initial = [...recs];
      outer: for (const r of initial) {
        for (const key of ctx.talkTos(r.body.memberKey)) {
          if (recs.length >= MAX_PANEL_BODIES) break outer;
          if (recs.some((x) => x.body.memberKey === key)) continue;
          const avatar = ctx.avatarOf(key);
          if (!avatar) continue;
          const neutral = avatar.bodyFromEmotion({ emotion: 0, intensity: 0 });
          recs.push({
            body: {
              memberKey: key,
              nick: ctx.nickOf(key),
              avatar,
              body: neutral,
              flip: false,
              requested: false,
              bbox: { left: 0, bottom: 0, right: 0, top: 0 },
              arrowX: 0,
              scale: 1,
            },
            priority: BR_GOODIDEA,
          });
        }
      }
    }

    // ---- greedy ordering (OrderAvatars/DoGreedyOrdering) ----
    const placed: Rec[] = [];
    const talkToCache = new Map<string, string[]>();
    const talkTosOf = (key: string) => {
      let t = talkToCache.get(key);
      if (!t) {
        t = ctx.talkTos(key);
        talkToCache.set(key, t);
      }
      return t;
    };

    const evalPair = (b1: Rec, b2: Rec, deltaPlacement: number): number => {
      let rating = 0;
      let desiredDir: boolean;
      if (deltaPlacement > 0) desiredDir = false;
      else {
        desiredDir = true;
        deltaPlacement = -deltaPlacement;
      }
      const talk = talkTosOf(b1.body.memberKey);
      if (talk.length === 0) {
        if (b1.body.flip !== desiredDir) rating += 4;
        if (b2.body.flip === desiredDir) rating += 2;
      } else {
        for (const t of talk) {
          if (t === b2.body.memberKey) {
            if (b1.body.flip === desiredDir) rating += 4 * (deltaPlacement - 1);
            else rating += 40;
            if (b2.body.flip === desiredDir) rating += 4;
          }
        }
      }
      return rating;
    };

    const displacementPenalty = (arr: Rec[]): number => {
      let penalty = 0;
      for (let i = 0; i < arr.length; i++) {
        const h = ctx.hysteresis(arr[i].body.memberKey);
        if (i > 0 && h.lastRight !== arr[i - 1].body.memberKey) penalty++;
        if (i < arr.length - 1 && h.lastLeft !== arr[i + 1].body.memberKey) penalty++;
      }
      return penalty;
    };

    const evalPlacement = (bdy: Rec, index: number): { rating: number; dir: boolean } => {
      placed.splice(index, 0, bdy);
      const penalty = displacementPenalty(placed);
      let ratingR = penalty,
        ratingL = penalty;

      bdy.body.flip = false;
      for (let i = 0; i < placed.length; i++) {
        for (let j = i + 1; j < placed.length; j++) {
          ratingR += evalPair(placed[i], placed[j], j - i) + evalPair(placed[j], placed[i], i - j);
        }
      }
      bdy.body.flip = true;
      for (let i = 0; i < placed.length; i++) {
        for (let j = i + 1; j < placed.length; j++) {
          ratingL += evalPair(placed[i], placed[j], j - i) + evalPair(placed[j], placed[i], i - j);
        }
      }
      placed.splice(index, 1);

      if (ratingR < ratingL) return { rating: ratingR, dir: false };
      if (ratingR > ratingL) return { rating: ratingL, dir: true };
      return { rating: ratingR, dir: ctx.hysteresis(bdy.body.memberKey).lastDir };
    };

    for (const r of recs) {
      let bestRating = 1000,
        bestPosition = 0,
        bestDir = false;
      for (let j = 0; j <= placed.length; j++) {
        const { rating, dir } = evalPlacement(r, j);
        if (rating < bestRating) {
          bestRating = rating;
          bestPosition = j;
          bestDir = dir;
        }
      }
      r.body.flip = bestDir;
      placed.splice(bestPosition, 0, r);
    }

    // ---- scaling & positions ----
    const maxBodyHeight = Math.floor(ctx.unitHeight / 1.9);
    const n = placed.length;
    const width: number[] = [],
      height: number[] = [],
      top: number[] = [];
    const headHeight: number[] = [],
      arrowFrac: number[] = [];
    let maxNorm = 0;
    const geos = placed.map((r) =>
      computeBodyGeometrySync(r.body.avatar, r.body.body, r.body.flip),
    );

    for (let i = 0; i < n; i++) {
      const g = geos[i];
      width[i] = g?.width ?? 100;
      height[i] = g?.height ?? 100;
      headHeight[i] = g?.headHeight ?? 50;
      arrowFrac[i] = g ? g.faceX / g.width : 0.5;
      maxNorm = Math.max(maxNorm, 100); // normHeight is constant 100
    }

    let bdyWidth = 0;
    for (let i = 0; i < n; i++) {
      const newHeight = Math.round(maxBodyHeight * (100 / maxNorm));
      const scaleRatio = newHeight / height[i];
      height[i] = newHeight;
      width[i] = Math.round(scaleRatio * width[i]);
      top[i] = -ctx.unitHeight + height[i];
      headHeight[i] = Math.round(scaleRatio * headHeight[i]);
      bdyWidth += width[i];
    }

    const sumWidth = bdyWidth;
    if (sumWidth > ctx.unitWidth) {
      const reduction = ctx.unitWidth / sumWidth;
      bdyWidth = 0;
      for (let i = 0; i < n; i++) {
        height[i] = Math.round(height[i] * reduction);
        width[i] = Math.round(width[i] * reduction);
        top[i] = -ctx.unitHeight + height[i];
        bdyWidth += width[i];
      }
      this.setBackdropBox(ctx, 0, 1.0);
    } else if (!establishing) {
      const widthFactor = ctx.unitWidth / sumWidth;
      let maxHeadHeight = 0;
      for (let i = 0; i < n; i++) maxHeadHeight = Math.max(maxHeadHeight, headHeight[i]);
      const headFactor = maxBodyHeight / (maxHeadHeight * 1.2);
      let zoomFactor = Math.min(widthFactor, headFactor);
      if (zoomFactor < 1.1) zoomFactor = 1.0;
      bdyWidth = 0;
      for (let i = 0; i < n; i++) {
        height[i] = Math.round(height[i] * zoomFactor);
        width[i] = Math.round(width[i] * zoomFactor);
        bdyWidth += width[i];
      }
      this.setBackdropBox(ctx, -ctx.unitHeight + maxBodyHeight, zoomFactor);
    } else {
      this.setBackdropBox(ctx, -ctx.unitHeight + maxBodyHeight, 1.0);
    }

    const margin = Math.floor((ctx.unitWidth - bdyWidth) / (n + 1));
    let xOffset = margin;
    for (let i = 0; i < n; i++) {
      const r = placed[i];
      const b = r.body;
      b.bbox = {
        left: xOffset,
        bottom: top[i] - height[i],
        right: xOffset + width[i],
        top: top[i],
      };
      b.arrowX = b.bbox.left + Math.round(arrowFrac[i] * (b.bbox.right - b.bbox.left));
      b.scale = geos[i] ? height[i] / geos[i]!.height : 1;
      this.bodies.push(b);
      xOffset += width[i] + margin;
    }

    // UpdateHistoresis
    for (let i = 0; i < n; i++) {
      const h = ctx.hysteresis(placed[i].body.memberKey);
      h.lastDir = placed[i].body.flip;
      if (i > 0) h.lastRight = placed[i - 1].body.memberKey;
      if (i < n - 1) h.lastLeft = placed[i + 1].body.memberKey;
    }

    // refresh balloon speaker refs
    for (const bal of this.balloons) {
      const body = this.bodies.find((bd) => bd.memberKey === bal.speaker?.key);
      if (body && bal.speaker) {
        bal.speaker.arrowX = body.arrowX;
        bal.speaker.bboxTop = body.bbox.top;
      }
    }
  }

  private setBackdropBox(ctx: PanelContext, fixedY: number, zoomFactor: number) {
    this.zoomFixedY = fixedY;
    this.zoomFactor = zoomFactor;
    const logHeight = Math.round(ctx.unitHeight / zoomFactor);
    const logWidth = Math.round(ctx.unitWidth / zoomFactor);
    const newFixedY = Math.round(fixedY / zoomFactor);
    const delta = fixedY - newFixedY;
    this.backdropBox = { left: 0, bottom: -logHeight + delta, right: logWidth, top: delta };
  }

  // -------------------------------------------------------------------------
  // LayoutBalloons

  getBalloonRect(ctx: PanelContext): SRect {
    const r: SRect = {
      left: 0,
      top: 0,
      right: ctx.unitWidth,
      bottom: -Math.floor(ctx.unitHeight / 2),
    };
    if (this.hasBorder) {
      r.left += PANEL_BORDER_WIDTH;
      r.right -= PANEL_BORDER_WIDTH;
      r.top -= PANEL_BORDER_WIDTH;
    }
    return r;
  }

  /** Returns true if everything fit; false → caller starts a new panel.
   *  On single over-tall balloon, force-fits and sets balloon.rest. */
  layoutBalloons(ctx: PanelContext): boolean {
    const freeRect = this.getBalloonRect(ctx);
    const rand = new MsvcRand(this.seed);
    const balloons = this.balloons;
    for (const b of balloons) {
      b.rand = rand;
      b.rest = null;
      b.routeRgn = { left: 0, right: 0 };
    }

    for (let i = 0; i < balloons.length; i++) {
      if (!this.layoutBalloon(balloons, i, freeRect, rand)) {
        if (i === 0 && balloons.length === 1) {
          this.forceFitBalloon(balloons[0], freeRect);
          return true;
        }
        console.debug(
          `[panel] balloon ${i}/${balloons.length} didn't fit ("${balloons[i].text.slice(0, 20)}...")`,
        );
        return false;
      }
    }
    return true;
  }

  private getCloudEstimate(
    balloons: Balloon[],
    index: number,
    freeRect: SRect,
    rand: MsvcRand,
  ): SRect {
    const balloon = balloons[index];
    const { area, len, lineHeight } = balloon.areaEstimate();
    const maxWidth = freeRect.right - freeRect.left;
    let goalWidth: number;

    if (len <= ONELINETHRESHOLD) {
      goalWidth = len;
    } else {
      let lowY = freeRect.top;
      for (let i = 0; i < index; i++) lowY = Math.min(lowY, balloons[i].bbox.bottom);
      const potentialHeight = lowY - freeRect.bottom + MINHOOKHEIGHT;
      let minWidth = potentialHeight > 0 ? Math.floor(area / potentialHeight) : maxWidth;
      minWidth = Math.max(minWidth, balloon.widestWord());
      goalWidth = minWidth + Math.floor(rand.randfloat() * (maxWidth - minWidth));
      void lineHeight;
    }

    goalWidth = Math.min(goalWidth + 200, maxWidth);
    goalWidth = Math.min(goalWidth, len + 200);

    const brect: SRect = { left: freeRect.left, right: 0, top: 0, bottom: freeRect.bottom };
    if (balloon.isBox) {
      brect.left = freeRect.left;
    } else {
      const toPtX = balloon.speaker!.arrowX;
      const leftLimit = toPtX - goalWidth;
      const rightLimit = toPtX;
      let startX = leftLimit + Math.floor(rand.randfloat() * (rightLimit - leftLimit));
      if (startX < freeRect.left) startX = freeRect.left;
      if (startX + goalWidth > freeRect.right) startX = freeRect.right - goalWidth;
      brect.left = startX;
    }
    brect.right = brect.left + goalWidth;
    return brect;
  }

  private getInterveningBBox(
    balloons: Balloon[],
    index: number,
    freeRect: SRect,
    irect: SRect,
  ): boolean {
    const toPtX = balloons[index].speaker?.arrowX ?? freeRect.left;
    let mostLeft = freeRect.left;
    let mostRight = freeRect.right;
    for (let i = 0; i < index; i++) {
      const a = balloons[i].queryRouteRgn(toPtX);
      mostLeft = Math.max(a.left, mostLeft);
      mostRight = Math.min(a.right, mostRight);
    }
    if (mostLeft > irect.left || mostRight < irect.right) {
      const clearance = mostRight - mostLeft;
      if (clearance >= irect.right - irect.left) {
        const delta = mostLeft > irect.left ? mostLeft - irect.left : mostRight - irect.right;
        irect.left += delta;
        irect.right += delta;
      } else {
        irect.left = mostLeft;
        irect.right = mostRight;
      }
    }

    irect.top = freeRect.top;
    for (let i = 0; i < index; i++) {
      const cloud = balloons[i].getCloudBBox();
      if (cloud.right < irect.left) {
        irect.top = Math.min(irect.top, cloud.top);
      } else {
        const dockDelta = TOPBORDER + YBORDER + HWAVEHEIGHT;
        irect.top = Math.min(irect.top, cloud.bottom + dockDelta);
      }
    }
    return true;
  }

  private layoutBalloon(
    balloons: Balloon[],
    index: number,
    freeRect: SRect,
    rand: MsvcRand,
  ): boolean {
    const brect = this.getCloudEstimate(balloons, index, freeRect, rand);
    if (!this.getInterveningBBox(balloons, index, freeRect, brect)) return false;

    const balloon = balloons[index];
    if (!balloon.setBBox(brect.left, brect.bottom, brect.right, brect.top)) {
      console.debug(`[panel] setBBox failed: w=${brect.right - brect.left}`);
      return false;
    }
    if (balloon.bbox.top > DOCK_SNAP) balloon.dockAtTop(freeRect.top);
    const cloud = balloon.getCloudBBox();
    balloon.routeRgn = { left: cloud.left, right: cloud.right };
    if (cloud.bottom < freeRect.bottom + MINHOOKHEIGHT) {
      console.debug(
        `[panel] no tail room: cloudBottom=${cloud.bottom} limit=${freeRect.bottom + MINHOOKHEIGHT} top=${brect.top}`,
      );
      return false;
    }

    // AdjustRouteRgns
    if (!balloon.isBox && balloon.speaker) {
      for (let i = 0; i < index; i++) {
        balloons[i].setRouteRgn(
          balloon.speaker.arrowX,
          balloon.routeRgn.left,
          balloon.routeRgn.right,
        );
      }
    }
    return true;
  }

  private forceFitBalloon(balloon: Balloon, freeRect: SRect) {
    balloon.setBBox(freeRect.left, freeRect.bottom, freeRect.right, freeRect.top);
    // split overflowing lines into a continuation
    const maxLines = Math.floor((freeRect.top - freeRect.bottom - 400) / balloon.font.lineHeight);
    const rest = balloon.truncateAtLine(maxLines);
    if (rest) {
      balloon.rest = rest;
      balloon.setBBox(freeRect.left, freeRect.bottom, freeRect.right, freeRect.top);
    }
    if (balloon.bbox.top > DOCK_SNAP) balloon.dockAtTop(freeRect.top);
    const cloud = balloon.getCloudBBox();
    balloon.routeRgn = { left: cloud.left, right: cloud.right };
  }
}
