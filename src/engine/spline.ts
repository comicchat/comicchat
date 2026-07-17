// Beta-spline port of spline.cpp (CBeta, tension 5.0, bias 1.0).
// Control points → cubic segments → Bézier control points, exactly like the
// original (including its integer rounding), so balloon outlines match.

import type { Pt } from './twips';

type Matrix = number[][];

const ROUND = (x: number) => Math.round(x);

function betaMatrix(tension: number, bias: number): Matrix {
  const b2 = bias * bias;
  const b3 = bias * b2;
  const d = 1.0 / (tension + 2.0 * b3 + 4.0 * (b2 + bias) + 2.0);
  const m: Matrix = [
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
  ];
  m[0][0] = -2.0 * b3;
  m[0][1] = 2.0 * (tension + b3 + b2 + bias);
  m[0][2] = -2.0 * (tension + b2 + bias + 1.0);
  m[1][0] = 6.0 * b3;
  m[1][1] = -3.0 * (tension + 2.0 * (b3 + b2));
  m[1][2] = 3.0 * (tension + 2.0 * b2);
  m[2][0] = -6.0 * b3;
  m[2][1] = 6.0 * (b3 - bias);
  m[2][2] = 6.0 * bias;
  m[3][0] = 2.0 * b3;
  m[3][1] = tension + 4.0 * (b2 + bias);
  m[0][3] = m[3][2] = 2.0;
  m[1][3] = m[2][3] = m[3][3] = 0.0;
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) m[i][j] *= d;
  return m;
}

const BETA_MATRIX = betaMatrix(5.0, 1.0);

export class BetaSpline {
  cps: Pt[];
  closed: boolean;
  bezpts: Pt[] = [];

  constructor(cps: Pt[], closed: boolean) {
    this.cps = cps.map((p) => ({ ...p }));
    this.closed = closed;
    this.computeBezpts();
  }

  clone(): BetaSpline {
    const s = Object.create(BetaSpline.prototype) as BetaSpline;
    s.cps = this.cps.map((p) => ({ ...p }));
    s.closed = this.closed;
    s.bezpts = this.bezpts.map((p) => ({ ...p }));
    return s;
  }

  /** CSpline::KnotCount for beta splines (GetDups() == 3 when open). */
  private knotCount(): number {
    return this.closed ? this.cps.length + 3 : this.cps.length + 4;
  }

  private getKnot(index: number): Pt {
    const n = this.cps.length;
    if (this.closed) {
      if (index === 0) return this.cps[n - 1];
      if (index === n + 1) return this.cps[0];
      if (index === n + 2) return this.cps[1];
      return this.cps[index - 1];
    }
    const dups = 3;
    if (index < dups) return this.cps[0];
    if (index >= n + dups - 2) return this.cps[n - 1];
    return this.cps[index - dups + 1];
  }

  computeBezpts() {
    const nKnots = this.knotCount();
    const bez: Pt[] = [];
    const m = BETA_MATRIX;
    let k0 = this.getKnot(0);
    let k1 = this.getKnot(1);
    let k2 = this.getKnot(2);
    let k3 = this.getKnot(3);
    for (let i = 0; ; i++) {
      // CvertsToCubic (note c3..c0 ordering in the original)
      const c3 = {
        x: ROUND(m[0][0] * k0.x + m[0][1] * k1.x + m[0][2] * k2.x + m[0][3] * k3.x),
        y: ROUND(m[0][0] * k0.y + m[0][1] * k1.y + m[0][2] * k2.y + m[0][3] * k3.y),
      };
      const c2 = {
        x: ROUND(m[1][0] * k0.x + m[1][1] * k1.x + m[1][2] * k2.x + m[1][3] * k3.x),
        y: ROUND(m[1][0] * k0.y + m[1][1] * k1.y + m[1][2] * k2.y + m[1][3] * k3.y),
      };
      const c1 = {
        x: ROUND(m[2][0] * k0.x + m[2][1] * k1.x + m[2][2] * k2.x + m[2][3] * k3.x),
        y: ROUND(m[2][0] * k0.y + m[2][1] * k1.y + m[2][2] * k2.y + m[2][3] * k3.y),
      };
      const c0 = {
        x: ROUND(m[3][0] * k0.x + m[3][1] * k1.x + m[3][2] * k2.x + m[3][3] * k3.x),
        y: ROUND(m[3][0] * k0.y + m[3][1] * k1.y + m[3][2] * k2.y + m[3][3] * k3.y),
      };
      // CubicToBezier
      const b0 = c0;
      const b1 = { x: c0.x + ROUND(c1.x / 3), y: c0.y + ROUND(c1.y / 3) };
      const b2 = { x: b1.x + ROUND((c1.x + c2.x) / 3), y: b1.y + ROUND((c1.y + c2.y) / 3) };
      const b3 = { x: c0.x + c1.x + c2.x + c3.x, y: c0.y + c1.y + c2.y + c3.y };
      if (i === 0) bez.push(b0);
      bez.push(b1, b2, b3);
      if (i + 4 === nKnots) break;
      k0 = k1; k1 = k2; k2 = k3; k3 = this.getKnot(i + 4);
    }
    this.bezpts = bez;
  }

  /** Nearest point on the spline to `toPt` (coarse, matching int_bezier_nearest_point use). */
  closestPoint(toPt: Pt): { point: Pt; knotIndex: number } {
    let minDist = Infinity;
    let best: Pt = this.bezpts[0];
    let bestKnot = 2;
    for (let i = 0; i + 3 < this.bezpts.length; i += 3) {
      const { dist, pos } = bezierNearest(this.bezpts, i, toPt);
      if (dist < minDist) {
        minDist = dist;
        best = pos;
        bestKnot = i / 3 + 2;
      }
    }
    return { point: best, knotIndex: bestKnot };
  }

  /** Walk from a knot to find the point where the outline reaches goalX
   *  (CSpline::WalkHorizontalDistance). */
  walkHorizontalDistance(fromKnotIndex: number, goalX: number): { point: Pt; knotIndex: number } {
    const bezCount = this.bezpts.length;
    let index = (fromKnotIndex - 2) * 3;
    let lastFurthest: Pt = { x: -100000, y: -100000 };
    let foundKnot = -1;
    for (let i = 0; i + 3 < bezCount + 3; i += 3) {
      if (index + 3 > bezCount - 1) index = 0;
      const seg = this.bezpts.slice(index, index + 4);
      const hit = walkSegToX(seg, goalX);
      if (hit.found) {
        return { point: hit.point, knotIndex: index / 3 + 2 };
      }
      if (hit.point.x > lastFurthest.x) {
        lastFurthest = hit.point;
        foundKnot = index / 3 + 2;
      }
      index += 3;
      if (i + 3 >= bezCount - 1) break;
    }
    return { point: lastFurthest, knotIndex: Math.max(foundKnot, 2) };
  }

  /** Flatten the whole spline into a polyline (for dashing). */
  flatten(stepsPerSeg = 16): Pt[] {
    const out: Pt[] = [];
    for (let i = 0; i + 3 < this.bezpts.length; i += 3) {
      for (let t = i === 0 ? 0 : 1; t <= stepsPerSeg; t++) {
        out.push(bezierAt(this.bezpts, i, t / stepsPerSeg));
      }
    }
    return out;
  }

  /** Append the spline to a canvas path (PolyBezierTo equivalent). */
  addToPath(ctx: CanvasRenderingContext2D, tx: (p: Pt) => [number, number], moveToFirst: boolean) {
    const b = this.bezpts;
    if (b.length < 4) return;
    if (moveToFirst) ctx.moveTo(...tx(b[0]));
    else ctx.lineTo(...tx(b[0]));
    for (let i = 1; i + 2 < b.length; i += 3) {
      ctx.bezierCurveTo(...tx(b[i]), ...tx(b[i + 1]), ...tx(b[i + 2]));
    }
  }
}

function bezierAt(bez: Pt[], base: number, t: number): Pt {
  const p0 = bez[base], p1 = bez[base + 1], p2 = bez[base + 2], p3 = bez[base + 3];
  const mt = 1 - t;
  const a = mt * mt * mt, b = 3 * mt * mt * t, c = 3 * mt * t * t, d = t * t * t;
  return {
    x: a * p0.x + b * p1.x + c * p2.x + d * p3.x,
    y: a * p0.y + b * p1.y + c * p2.y + d * p3.y,
  };
}

function bezierNearest(bez: Pt[], base: number, toPt: Pt): { dist: number; pos: Pt } {
  let minDist = Infinity;
  let best = bez[base];
  const STEPS = 24;
  for (let s = 0; s <= STEPS; s++) {
    const p = bezierAt(bez, base, s / STEPS);
    const d = Math.abs(p.x - toPt.x) + Math.abs(p.y - toPt.y);
    if (d < minDist) { minDist = d; best = p; }
  }
  return { dist: minDist, pos: best };
}

function walkSegToX(seg: Pt[], goalX: number): { found: boolean; point: Pt } {
  const STEPS = 24;
  let furthest = seg[0];
  for (let s = 0; s <= STEPS; s++) {
    const p = bezierAt(seg, 0, s / STEPS);
    if (p.x >= goalX) return { found: true, point: p };
    if (p.x > furthest.x) furthest = p;
  }
  return { found: false, point: furthest };
}
