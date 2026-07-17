// Balloon engine — faithful port of balloon.cpp (CBWoodring* classes).
// All geometry in twips, y-up. Text measured via canvas at 96 DPI (15 twips/px).

import { BetaSpline } from './spline';
import type { MsvcRand } from './rand';
import {
  DEFAULT_FORMAT,
  FORMAT_COLORS,
  sameFormat,
  symbolize,
  type CharFormat,
  type TextSegment,
} from './richtext';
import {
  XBORDER,
  YBORDER,
  TOPBORDER,
  THRESH1,
  THRESH2,
  HWAVEHEIGHT,
  HWAVEINTERVAL,
  VWAVEHEIGHT,
  VWAVEINTERVAL,
  XBOXDELTA,
  YBOXDELTA,
  BUBBLEHEIGHT,
  INTERBUBBLE,
  ENDBUBBLEWIDTH,
  MINTAILHEIGHT,
  SMALLDELTA,
  LARGEDELTA,
  TAIL_GAP_HALF,
  MAXLINES,
  TWIPS_PER_PX,
  BALLOON_FONT_FAMILY,
  BALLOON_FONT_TWIPS,
  LARGEINTEGER,
  MINROUTEWIDTH,
  TOPBORDER as TOP_BORDER,
  type SRect,
  type Pt,
} from './twips';

export type BalloonType = 'say' | 'think' | 'whisper' | 'box' | 'whisperbox';

/** A word (or space-joined chunk) with one character format. */
interface StyledWord {
  text: string;
  fmt: CharFormat;
}

interface StyledLine {
  chunks: StyledWord[];
  width: number;
}

function linePlain(l: StyledLine): string {
  return l.chunks.map((c) => c.text).join('');
}

// ---------------------------------------------------------------------------
// Fonts & measurement (CFontInfo)

export interface FontInfo {
  cssFont: string; // canvas font string in px
  sizeTwips: number;
  italic: boolean;
  family: string;
  lineHeight: number; // twips: tmHeight + leading
  topOffset: number; // twips
  baseAdd: number; // twips
}

let measureCanvas: OffscreenCanvas | HTMLCanvasElement | null = null;
let measureCtx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null = null;

function ctx2d() {
  if (!measureCtx) {
    measureCanvas =
      typeof OffscreenCanvas !== 'undefined'
        ? new OffscreenCanvas(8, 8)
        : document.createElement('canvas');
    measureCtx = measureCanvas.getContext('2d') as CanvasRenderingContext2D;
  }
  return measureCtx!;
}

export function makeFontInfo(
  sizeTwips: number,
  italic: boolean,
  family = BALLOON_FONT_FAMILY,
): FontInfo {
  const px = sizeTwips / TWIPS_PER_PX;
  const cssFont = `${italic ? 'italic ' : ''}${px}px ${family}`;
  const c = ctx2d();
  c.font = cssFont;
  const m = c.measureText('Mg');
  const tmHeightPx =
    (m.fontBoundingBoxAscent ?? px * 0.8) + (m.fontBoundingBoxDescent ?? px * 0.25);
  const tmHeight = Math.round(tmHeightPx * TWIPS_PER_PX);
  // fonts.cpp: the Comic Sans vertical kerning (leading -40, baseAdd +30,
  // scaled by size/180) applies only to Comic Sans, like doVKern.
  const isComic = /comic sans/i.test(family);
  const reduction = sizeTwips / BALLOON_FONT_TWIPS;
  const leading = isComic ? Math.round(-40 * reduction) : 0;
  const baseAdd = isComic ? Math.round(30 * reduction) : 0;
  return {
    cssFont,
    sizeTwips,
    italic,
    family,
    lineHeight: tmHeight + leading,
    topOffset: 0,
    baseAdd,
  };
}

export function textWidthTwips(font: FontInfo, text: string): number {
  const c = ctx2d();
  c.font = font.cssFont;
  return Math.round(c.measureText(text).width * TWIPS_PER_PX);
}

/** Canvas font string for a character format on top of a base font. */
export function fontFor(base: FontInfo, fmt: CharFormat): string {
  const px = base.sizeTwips / TWIPS_PER_PX;
  const italic = base.italic || fmt.italic;
  const family = fmt.fixed
    ? '"Courier New", monospace'
    : fmt.symbol
      ? 'Symbol, serif'
      : base.family;
  return `${italic ? 'italic ' : ''}${fmt.bold ? 'bold ' : ''}${px}px ${family}`;
}

function styledWidthTwips(base: FontInfo, w: StyledWord): number {
  const c = ctx2d();
  c.font = fontFor(base, w.fmt);
  const text = w.fmt.symbol ? symbolize(w.text) : w.text;
  return Math.round(c.measureText(text).width * TWIPS_PER_PX);
}

// ---------------------------------------------------------------------------
// Line breaking (format.cpp BreakIntoLines, simplified to plain text)

export interface FormatInfo {
  lines: StyledLine[];
  widths: number[];
  leftX: number[];
  nLines: number;
  maxWidth: number; // widest line
  bbox: SRect; // text box: Left=0, Top=0, Right=wrap width, Bottom=-nLines*lineHeight
}

/** Word-wrap styled segments. Mid-word format changes snap to word starts. */
function breakIntoLines(
  font: FontInfo,
  segments: TextSegment[],
  maxWidth: number,
): StyledLine[] | null {
  // Tokenize into styled words.
  const words: StyledWord[] = [];
  for (const seg of segments) {
    for (const w of seg.text.split(/\s+/)) {
      if (w.length > 0) words.push({ text: w, fmt: seg.fmt });
    }
  }

  const lines: StyledLine[] = [];
  let cur: StyledLine = { chunks: [], width: 0 };

  const flush = () => {
    if (cur.chunks.length) {
      lines.push(cur);
      cur = { chunks: [], width: 0 };
    }
  };
  const append = (w: StyledWord, width: number) => {
    const last = cur.chunks[cur.chunks.length - 1];
    const space = cur.chunks.length ? styledWidthTwips(font, { text: ' ', fmt: w.fmt }) : 0;
    if (last && sameFormat(last.fmt, w.fmt)) last.text += (cur.chunks.length ? ' ' : '') + w.text;
    else
      cur.chunks.push({
        text: (cur.chunks.length ? ' ' : '') + w.text,
        fmt: w.fmt,
      });
    cur.width += width + space;
  };

  for (let w of words) {
    // force-break monster words
    let wWidth = styledWidthTwips(font, w);
    while (wWidth > maxWidth) {
      flush();
      let cut = w.text.length - 1;
      while (
        cut > 1 &&
        styledWidthTwips(font, { text: w.text.slice(0, cut), fmt: w.fmt }) > maxWidth
      )
        cut--;
      const head = { text: w.text.slice(0, cut), fmt: w.fmt };
      lines.push({ chunks: [head], width: styledWidthTwips(font, head) });
      w = { text: w.text.slice(cut), fmt: w.fmt };
      wWidth = styledWidthTwips(font, w);
    }
    const space = cur.chunks.length ? styledWidthTwips(font, { text: ' ', fmt: w.fmt }) : 0;
    if (cur.chunks.length && cur.width + space + wWidth > maxWidth) {
      flush();
      append(w, wWidth);
    } else {
      append(w, wWidth);
    }
    if (lines.length > MAXLINES) return null;
  }
  flush();
  if (lines.length === 0)
    lines.push({
      chunks: [{ text: '', fmt: { ...DEFAULT_FORMAT } }],
      width: 0,
    });
  if (lines.length > MAXLINES) return null;
  return lines;
}

// ---------------------------------------------------------------------------
// Filters (balloon.cpp GetFilters/PermuteFilters) — the staircase outline

interface Range {
  x: number;
  y: number;
  start: number;
  end: number;
}

function getFilters(fInfo: FormatInfo): { l: Range[]; r: Range[] } {
  const l: Range[] = [{ x: fInfo.leftX[0], y: 0, start: 0, end: 0 }];
  const r: Range[] = [{ x: fInfo.leftX[0] + fInfo.widths[0], y: 0, start: 0, end: 0 }];

  for (let i = 1; i < fInfo.nLines; i++) {
    const thisLeft = fInfo.leftX[i];
    const thisRight = fInfo.leftX[i] + fInfo.widths[i];
    const lTop = l[l.length - 1];
    const rTop = r[r.length - 1];
    const leftDelta = thisLeft - lTop.x;
    const rightDelta = thisRight - rTop.x;

    if (leftDelta <= THRESH1) {
      lTop.end = i - 1;
      l.push({ x: thisLeft, y: 0, start: i, end: i });
    } else if (leftDelta <= 0) {
      lTop.x = thisLeft;
    } else if (leftDelta >= THRESH2) {
      const nextLeft = i + 1 < fInfo.nLines ? fInfo.leftX[i + 1] : thisLeft;
      if (nextLeft - lTop.x >= THRESH2) {
        lTop.end = i - 1;
        l.push({ x: Math.min(thisLeft, nextLeft), y: 0, start: i, end: i });
      }
    }

    if (rightDelta >= -THRESH1) {
      rTop.end = i - 1;
      r.push({ x: thisRight, y: 0, start: i, end: i });
    } else if (rightDelta >= 0) {
      rTop.x = thisRight;
    } else if (rightDelta <= -THRESH2) {
      const nextRight = i + 1 < fInfo.nLines ? fInfo.leftX[i + 1] + fInfo.widths[i + 1] : thisRight;
      if (nextRight - rTop.x <= -THRESH2) {
        rTop.end = i - 1;
        r.push({ x: Math.max(thisRight, nextRight), y: 0, start: i, end: i });
      }
    }
  }

  l[l.length - 1].end = fInfo.nLines - 1;
  r[r.length - 1].end = fInfo.nLines - 1;
  return { l, r };
}

function permuteFilters(font: FontInfo, l: Range[], r: Range[]): number {
  let baseY = 0;
  let lastX = LARGEINTEGER;
  for (let i = 0; i < l.length; i++) {
    l[i].x -= XBORDER;
    if (i === 0) l[i].y = baseY + TOPBORDER + YBORDER + font.topOffset;
    else if (l[i].x < lastX) l[i].y = baseY + YBORDER;
    else l[i].y = baseY - YBORDER - font.baseAdd;
    baseY -= (l[i].end - l[i].start + 1) * font.lineHeight;
    lastX = l[i].x;
  }

  baseY = 0;
  lastX = -LARGEINTEGER;
  for (let i = 0; i < r.length; i++) {
    r[i].x += XBORDER;
    if (i === 0) r[i].y = baseY + TOPBORDER + YBORDER + font.topOffset;
    else if (r[i].x > lastX) r[i].y = baseY + YBORDER;
    else r[i].y = baseY - YBORDER - font.baseAdd;
    baseY -= (r[i].end - r[i].start + 1) * font.lineHeight;
    lastX = r[i].x;
  }
  return baseY - TOPBORDER - YBORDER - font.baseAdd;
}

function addWavies(pt1: Pt, pt2: Pt, pts: Pt[], waveDiam: number, interval: number) {
  const dist = Math.hypot(pt2.x - pt1.x, pt2.y - pt1.y);
  const nWaves = dist / interval;
  if (nWaves < 2) return;
  const iWaves = Math.floor(nWaves);
  const waveLen = dist / iWaves;
  const ux = (pt2.x - pt1.x) / dist;
  const uy = (pt2.y - pt1.y) / dist;
  const incX = Math.round(waveLen * ux); // dpoint_to_point truncation ~ round
  const incY = Math.round(waveLen * uy);
  const exX = Math.round(waveDiam * uy); // normal = (uy, -ux)
  const exY = Math.round(waveDiam * -ux);
  let bx = pt1.x,
    by = pt1.y;
  for (let i = 0; i < iWaves - 1; i++) {
    bx += incX;
    by += incY;
    if (!(i & 1)) pts.push({ x: bx + exX, y: by + exY });
    else pts.push({ x: bx, y: by });
  }
}

// ---------------------------------------------------------------------------
// Tail helpers (BreakSpline + arcs)

/** BreakSpline: open a gap in the closed outline around (x, y). Returns the
 *  opened spline (control points reordered to start right of the gap). */
function breakSpline(spline: BetaSpline, x: number, y: number): BetaSpline {
  const gapwidth = TAIL_GAP_HALF;
  const left = { x: x - gapwidth, y };
  const { point: leftNearest, knotIndex: leftKnot } = spline.closestPoint(left);
  const walked = spline.walkHorizontalDistance(leftKnot, leftNearest.x + 2 * gapwidth);
  const rightNearest = walked.point;
  const rightKnot = walked.knotIndex;

  const nCps = spline.cps.length;
  const newCps: Pt[] = [];
  newCps.push({ x: Math.round(rightNearest.x), y: Math.round(rightNearest.y) });
  for (let i = 1; i <= nCps; i++) {
    newCps.push({ ...spline.cps[(rightKnot + i - 2 + nCps) % nCps] });
  }
  const nCpsNew = nCps + 2 - ((rightKnot - leftKnot + nCps) % nCps);
  newCps.length = Math.max(2, Math.min(newCps.length, nCpsNew - 1));
  newCps.push({ x: Math.round(leftNearest.x), y: Math.round(leftNearest.y) });

  const s = new BetaSpline(newCps, false);
  return s;
}

/** Arc through start→end bowing by `altitude` (arc.cpp DrawArc2), emitted as
 *  a polyline in twips. */
function arcPoints(start: Pt, end: Pt, altitude: number, out: Pt[]) {
  if (altitude > -1 && altitude < 1) {
    out.push(end);
    return;
  }
  const mid = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
  const e2m = { x: mid.x - end.x, y: mid.y - end.y };
  const e2mDist = Math.hypot(e2m.x, e2m.y);
  if (e2mDist < 1) {
    out.push(end);
    return;
  }
  const radius = (e2mDist * e2mDist + altitude * altitude) / (2 * altitude);
  const midToCenterDist = radius - altitude;
  let mc = { x: e2m.y, y: -e2m.x };
  const mcLen = Math.hypot(mc.x, mc.y);
  mc = {
    x: (mc.x * midToCenterDist) / mcLen,
    y: (mc.y * midToCenterDist) / mcLen,
  };
  const center = { x: mid.x + mc.x, y: mid.y + mc.y };
  const a0 = Math.atan2(start.y - center.y, start.x - center.x);
  let a1 = Math.atan2(end.y - center.y, end.x - center.x);
  const ccw = altitude > 0;
  if (ccw && a1 < a0) a1 += 2 * Math.PI;
  if (!ccw && a1 > a0) a1 -= 2 * Math.PI;
  const R = Math.abs(radius);
  const steps = Math.max(4, Math.ceil((Math.abs(a1 - a0) * R) / 120));
  for (let s = 1; s <= steps; s++) {
    const a = a0 + ((a1 - a0) * s) / steps;
    out.push({ x: center.x + Math.cos(a) * R, y: center.y + Math.sin(a) * R });
  }
}

// ---------------------------------------------------------------------------
// The balloon

export interface SpeakerRef {
  arrowX: number; // panel coords (twips)
  bboxTop: number; // speaker's bbox top (y-up panel coords)
  key: string; // member key, for identity checks
}

export class Balloon {
  type: BalloonType;
  text: string; // plain uppercase text (no codes)
  segments: TextSegment[]; // styled runs, uppercased
  font: FontInfo;
  speaker: SpeakerRef | null = null;
  rand: MsvcRand | null = null;

  bbox: SRect = { left: 0, bottom: 0, right: 0, top: 0 };
  trueBox: SRect = { left: 0, bottom: 0, right: 0, top: 0 };
  routeRgn = { left: 0, right: 0 };
  fInfo: FormatInfo | null = null;
  spline: BetaSpline | null = null;
  rest: string | null = null; // leftover text after force-fit split

  constructor(type: BalloonType, textOrSegments: string | TextSegment[], font: FontInfo) {
    this.type = type;
    this.font = font;
    // Capitalize(m_str) — balloon text is uppercased like the original.
    const segs =
      typeof textOrSegments === 'string'
        ? [{ text: textOrSegments, fmt: { ...DEFAULT_FORMAT } }]
        : textOrSegments;
    this.segments = segs.map((s) => ({
      text: s.text.toLocaleUpperCase(),
      fmt: { ...s.fmt },
    }));
    this.text = this.segments.map((s) => s.text).join('');
  }

  get isBox() {
    return this.type === 'box' || this.type === 'whisperbox';
  }
  get dashed() {
    return this.type === 'whisper' || this.type === 'whisperbox';
  }

  /** CLabel::AreaEstimate */
  areaEstimate(): { area: number; len: number; lineHeight: number } {
    let len = 0;
    for (const s of this.segments) len += styledWidthTwips(this.font, { text: s.text, fmt: s.fmt });
    const tmHeight =
      this.font.lineHeight - Math.round(-40 * (this.font.sizeTwips / BALLOON_FONT_TWIPS));
    return {
      len,
      lineHeight: this.font.lineHeight,
      area: Math.floor(1.3 * len * (tmHeight + this.font.lineHeight)),
    };
  }

  widestWord(): number {
    let max = 0;
    for (const s of this.segments) {
      for (const w of s.text.split(/\s+/)) {
        if (w) max = Math.max(max, styledWidthTwips(this.font, { text: w, fmt: s.fmt }));
      }
    }
    return max;
  }

  /** CBalloon::SetBBox — wrap text to the box width, compute the outline,
   *  then anchor the cloud at (left, top). */
  setBBox(left: number, bottom: number, right: number, top: number): boolean {
    const sameSize =
      this.bbox.right - this.bbox.left === right - left &&
      this.bbox.top - this.bbox.bottom === top - bottom &&
      this.fInfo;
    if (!sameSize) {
      const wrapWidth = right - left - 2 * XBORDER;
      if (wrapWidth < 50) return false;
      if (!this.computeInternals(wrapWidth)) return false;
      bottom = top + this.trueBox.bottom - this.trueBox.top;
    }
    this.bbox.left = left - this.trueBox.left;
    this.bbox.right = right - this.trueBox.left;
    this.bbox.top = top - this.trueBox.top;
    this.bbox.bottom = bottom - this.trueBox.top;
    return true;
  }

  /** ComputeInternals: break into lines, shift (center), build spline. */
  private computeInternals(wrapWidth: number): boolean {
    const lines = breakIntoLines(this.font, this.segments, wrapWidth);
    if (!lines) return false;
    const widths = lines.map((l) => l.width);
    const maxWidth = Math.max(...widths);
    const fInfo: FormatInfo = {
      lines,
      widths,
      leftX: [],
      nLines: lines.length,
      maxWidth,
      bbox: {
        left: 0,
        top: 0,
        right: wrapWidth,
        bottom: -lines.length * this.font.lineHeight,
      },
    };
    // ShiftLines (MAXCENTERSHIFT/MAXLEFTSHIFT are 0 in the original build)
    for (let i = 0; i < fInfo.nLines; i++) {
      fInfo.leftX[i] = this.isBox ? 0 : Math.floor((wrapWidth - widths[i]) / 2);
    }
    this.fInfo = fInfo;

    if (this.isBox) {
      // CBWoodringBox::ComputeCloudBBox
      this.trueBox = {
        left: fInfo.bbox.left - XBOXDELTA,
        right: fInfo.bbox.right + XBOXDELTA,
        bottom: fInfo.bbox.bottom - YBOXDELTA,
        top: fInfo.bbox.top + YBOXDELTA,
      };
      this.spline = null;
      return true;
    }

    this.spline = this.createBalloonSpline(fInfo);
    // ComputeCloudBBox: bbox over spline control points
    const t = {
      left: Infinity,
      right: -Infinity,
      top: -Infinity,
      bottom: Infinity,
    };
    for (const p of this.spline.cps) {
      t.left = Math.min(t.left, p.x);
      t.right = Math.max(t.right, p.x);
      t.top = Math.max(t.top, p.y);
      t.bottom = Math.min(t.bottom, p.y);
    }
    this.trueBox = t;
    return true;
  }

  /** CBWoodringNormal::CreateBalloonSpline */
  private createBalloonSpline(fInfo: FormatInfo): BetaSpline {
    const lr = getFilters(fInfo);
    const finalY = permuteFilters(this.font, lr.l, lr.r);
    const pts: Pt[] = [];
    const l = lr.l,
      r = lr.r;
    let lastY = finalY;

    for (let i = 0; i < l.length; i++) {
      const thisPoint = { x: l[i].x, y: l[i].y };
      if (i > 0) addWavies(pts[pts.length - 1], thisPoint, pts, HWAVEHEIGHT, HWAVEINTERVAL);
      pts.push(thisPoint);
      const nextPoint = {
        x: l[i].x,
        y: i === l.length - 1 ? finalY : l[i + 1].y,
      };
      addWavies(pts[pts.length - 1], nextPoint, pts, VWAVEHEIGHT, VWAVEINTERVAL);
      pts.push(nextPoint);
    }
    for (let i = r.length - 1; i >= 0; i--) {
      const thisPoint = { x: r[i].x, y: lastY };
      addWavies(pts[pts.length - 1], thisPoint, pts, HWAVEHEIGHT, HWAVEINTERVAL);
      pts.push(thisPoint);
      lastY = r[i].y;
      const nextPoint = { x: r[i].x, y: lastY };
      addWavies(pts[pts.length - 1], nextPoint, pts, VWAVEHEIGHT, VWAVEINTERVAL);
      pts.push(nextPoint);
    }
    addWavies(pts[pts.length - 1], pts[0], pts, HWAVEHEIGHT, HWAVEINTERVAL);
    return new BetaSpline(pts, true);
  }

  /** Plain text of the wrapped lines (for splitting/inspection). */
  plainLines(): string[] {
    return this.fInfo ? this.fInfo.lines.map(linePlain) : [this.text];
  }

  /** Truncate to maxLines with '...' continuations; returns the remainder
   *  (plain text) or null if it already fits. Formatting does not survive
   *  a split. */
  truncateAtLine(maxLines: number): string | null {
    if (!this.fInfo || this.fInfo.nLines <= maxLines || maxLines < 1) return null;
    const plain = this.fInfo.lines.map(linePlain);
    const keep = plain.slice(0, maxLines).join(' ') + '...';
    const rest = '...' + plain.slice(maxLines).join(' ');
    this.segments = [{ text: keep, fmt: { ...DEFAULT_FORMAT } }];
    this.text = keep;
    this.fInfo = null; // force re-wrap on next setBBox
    return rest;
  }

  getCloudBBox(): SRect {
    return {
      left: this.trueBox.left + this.bbox.left,
      right: this.trueBox.right + this.bbox.left,
      top: this.trueBox.top + this.bbox.top,
      bottom: this.trueBox.bottom + this.bbox.top,
    };
  }

  dockAtTop(height: number) {
    const oldH = this.bbox.top - this.bbox.bottom;
    this.bbox.top = height + TOP_BORDER;
    this.bbox.bottom = this.bbox.top - oldH;
  }

  /** CBalloon::QueryRouteRgn */
  queryRouteRgn(otherToX: number): { left: number; right: number } {
    if (this.isBox) return { left: -LARGEINTEGER, right: LARGEINTEGER };
    const toX = this.speaker!.arrowX;
    if (otherToX > toX) {
      return {
        left: Math.max(toX, this.routeRgn.left + MINROUTEWIDTH),
        right: LARGEINTEGER,
      };
    }
    return {
      left: -LARGEINTEGER,
      right: Math.min(toX, this.routeRgn.right - MINROUTEWIDTH),
    };
  }

  setRouteRgn(otherToX: number, left: number, right: number) {
    if (this.isBox) return;
    const toX = this.speaker!.arrowX;
    if (otherToX > toX) this.routeRgn.right = Math.min(this.routeRgn.right, left);
    else this.routeRgn.left = Math.max(this.routeRgn.left, right);
  }

  // -- tail construction (AddArrow) ----------------------------------------

  /** Builds the open outline + tail arc polylines, in PANEL coordinates.
   *  Returns null for think/box balloons (closed shapes). */
  private buildTail(): {
    opened: BetaSpline;
    arcInto: Pt[];
    arcBack: Pt[];
  } | null {
    if (this.type === 'think' || this.isBox || !this.spline || !this.speaker || !this.fInfo)
      return null;

    const bbox = this.bbox;
    const bottom2 = { x: this.speaker.arrowX, y: this.speaker.bboxTop + 200 };
    const bottom = { x: bottom2.x - bbox.left, y: bottom2.y - bbox.top };
    const cbbox = this.getCloudBBox();

    let xbreak = Math.floor((this.routeRgn.left + this.routeRgn.right) / 2) - bbox.left;
    const lastLine = this.fInfo.nLines - 1;
    const bottomStart = this.fInfo.leftX[lastLine];
    const bottomEnd = bottomStart + this.fInfo.widths[lastLine];
    if (xbreak < bottomStart && bottomStart + bbox.left < this.routeRgn.right - LARGEDELTA) {
      xbreak = bottomStart + SMALLDELTA;
    } else if (xbreak > bottomEnd && bottomEnd + bbox.left > this.routeRgn.left + LARGEDELTA) {
      xbreak = bottomEnd - SMALLDELTA;
    }

    const top2 = { x: xbreak + bbox.left, y: cbbox.bottom };
    if (top2.y - bottom2.y < MINTAILHEIGHT) {
      bottom2.y = top2.y - MINTAILHEIGHT;
      bottom.y = bottom2.y - bbox.top;
    }

    // limit tail angle to 45°
    const ang = Math.atan2(top2.y - bottom2.y, top2.x - bottom2.x);
    if (Math.abs(ang) - Math.PI / 2 > Math.PI / 4) {
      const clamped = ang > (3 * Math.PI) / 4 ? (3 * Math.PI) / 4 : Math.PI / 4;
      const heightDelta = top2.y - bottom2.y;
      xbreak = Math.floor(Math.cos(clamped) * heightDelta + bottom2.x - bbox.left);
    }

    const opened = breakSpline(this.spline, xbreak, this.fInfo.bbox.bottom);
    const left = opened.cps[opened.cps.length - 1];
    const right = opened.cps[0];
    const mid = {
      x: (left.x + right.x) / 2 + bbox.left,
      y: (left.y + right.y) / 2 + bbox.top,
    };
    const tailLen = Math.hypot(mid.x - bottom2.x, mid.y - bottom2.y);
    const alt = Math.floor(0.05 * tailLen);
    const sign = bottom.x > left.x ? 1 : -1;

    const arcInto: Pt[] = [];
    arcPoints(left, bottom, sign * alt, arcInto);
    const arcBack: Pt[] = [];
    arcPoints(bottom, right, -sign * alt, arcBack);
    return { opened, arcInto, arcBack };
  }

  // -- drawing ---------------------------------------------------------------

  /** Draw into ctx. `tx` maps balloon-local twips to canvas px; `txPanel`
   *  maps panel twips (for think bubbles). */
  draw(
    ctx: CanvasRenderingContext2D,
    twipsToPx: number,
    panelToCanvas: (x: number, y: number) => [number, number],
  ) {
    const toCanvas = (p: Pt): [number, number] =>
      panelToCanvas(p.x + this.bbox.left, p.y + this.bbox.top);

    const penPx = Math.max(1, 28 * twipsToPx);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    if (this.isBox) {
      const t = this.trueBox;
      const [x0, y0] = toCanvas({ x: t.left, y: t.top });
      const [x1, y1] = toCanvas({ x: t.right, y: t.bottom });
      ctx.beginPath();
      ctx.rect(x0, y0, x1 - x0, y1 - y0);
      ctx.fillStyle = 'white';
      ctx.fill();
      ctx.strokeStyle = 'black';
      ctx.lineWidth = penPx;
      if (this.dashed) ctx.setLineDash([100 * twipsToPx, 100 * twipsToPx]);
      ctx.stroke();
      ctx.setLineDash([]);
      this.drawText(ctx, toCanvas);
      return;
    }

    if (!this.spline) return;

    const tail = this.buildTail();
    const buildPath = () => {
      ctx.beginPath();
      if (tail) {
        tail.opened.addToPath(ctx, (p) => toCanvas(p), true);
        for (const p of tail.arcInto) ctx.lineTo(...toCanvas(p));
        for (const p of tail.arcBack) ctx.lineTo(...toCanvas(p));
        ctx.closePath();
      } else {
        this.spline!.addToPath(ctx, (p) => toCanvas(p), true);
        ctx.closePath();
      }
    };

    if (this.dashed) {
      // whisper: fat white halo stroke + white fill, then black dashes
      buildPath();
      ctx.fillStyle = 'white';
      ctx.fill();
      ctx.strokeStyle = 'white';
      ctx.lineWidth = 100 * twipsToPx;
      ctx.stroke();
      buildPath();
      ctx.strokeStyle = 'black';
      ctx.lineWidth = penPx;
      ctx.setLineDash([100 * twipsToPx, 100 * twipsToPx]);
      ctx.stroke();
      ctx.setLineDash([]);
    } else {
      buildPath();
      ctx.fillStyle = 'white';
      ctx.fill();
      ctx.strokeStyle = 'black';
      ctx.lineWidth = penPx;
      ctx.stroke();
    }

    if (this.type === 'think' && this.speaker) {
      this.drawThinkBubbles(ctx, twipsToPx, panelToCanvas);
    }

    this.drawText(ctx, toCanvas);
  }

  /** CBWoodringThink::Draw bubbles */
  private drawThinkBubbles(
    ctx: CanvasRenderingContext2D,
    twipsToPx: number,
    panelToCanvas: (x: number, y: number) => [number, number],
  ) {
    const entry = {
      x: Math.floor((this.routeRgn.left + this.routeRgn.right) / 2),
      y: this.fInfo!.bbox.bottom + this.bbox.top,
    };
    const tailPt = { x: this.speaker!.arrowX, y: this.speaker!.bboxTop + 200 };
    const deltaY = entry.y - tailPt.y;
    if (deltaY < 0) return;
    const nBubbles = Math.floor((deltaY + INTERBUBBLE) / (BUBBLEHEIGHT + INTERBUBBLE));
    if (nBubbles <= 0) return;
    const spacing = nBubbles > 1 ? (deltaY - BUBBLEHEIGHT * nBubbles) / (nBubbles - 1) : 0;
    const dx = entry.x - tailPt.x,
      dy = entry.y - tailPt.y;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len,
      uy = dy / len;
    let cx = tailPt.x + (ux * BUBBLEHEIGHT) / 2;
    let cy = tailPt.y + (uy * BUBBLEHEIGHT) / 2;
    const incX = ux * (BUBBLEHEIGHT + spacing);
    const incY = uy * (BUBBLEHEIGHT + spacing);
    const widthDelta = nBubbles > 1 ? (ENDBUBBLEWIDTH - BUBBLEHEIGHT) / (2 * (nBubbles - 1)) : 0;
    let widthAdj = 0;

    ctx.fillStyle = 'white';
    ctx.strokeStyle = 'black';
    ctx.lineWidth = Math.max(1, 28 * twipsToPx);
    for (let i = 0; i < nBubbles; i++) {
      const [px, py] = panelToCanvas(cx, cy);
      const rx = (BUBBLEHEIGHT / 2 + widthAdj) * twipsToPx;
      const ry = (BUBBLEHEIGHT / 2) * twipsToPx;
      ctx.beginPath();
      ctx.ellipse(px, py, rx, ry, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      cx += incX;
      cy += incY;
      widthAdj += widthDelta;
    }
  }

  private drawText(ctx: CanvasRenderingContext2D, toCanvas: (p: Pt) => [number, number]) {
    if (!this.fInfo) return;
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    const lineH = this.font.lineHeight;
    // Glyph ink sits high in the CSS font box compared to GDI's cell; nudge
    // the text down to center it in the balloon (75 twips ≈ 5px).
    const NUDGE = 50;
    for (let i = 0; i < this.fInfo.nLines; i++) {
      const line = this.fInfo.lines[i];
      const position = toCanvas({ x: this.fInfo.leftX[i], y: -i * lineH - NUDGE });
      let x = position[0];
      const y = position[1];
      for (const chunk of line.chunks) {
        ctx.font = fontFor(this.font, chunk.fmt);
        ctx.fillStyle = chunk.fmt.color !== null ? FORMAT_COLORS[chunk.fmt.color] : 'black';
        const text = chunk.fmt.symbol ? symbolize(chunk.text) : chunk.text;
        ctx.fillText(text, x, y);
        const w = ctx.measureText(text).width;
        if (chunk.fmt.underline) {
          const uy = y + this.font.sizeTwips / TWIPS_PER_PX + 1;
          ctx.strokeStyle = ctx.fillStyle as string;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(x, uy);
          ctx.lineTo(x + w, uy);
          ctx.stroke();
        }
        x += w;
      }
    }
  }
}
