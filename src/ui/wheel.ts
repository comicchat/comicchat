// The emotion wheel: 8 faces at 45° steps around a circle, draggable dot.
// Angle picks the emotion (avatar.h: EM_x = i*2π/8), distance from the
// center picks the intensity. Center = neutral.

import { EM } from '../art/types';
import type { Emotion } from '../art/types';
import { publicUrl } from '../public-url';

// Order around the wheel matches the original layout: happy at 3 o'clock,
// angles grow clockwise in screen space (y down).
const FACES = [
  { file: 'fc_hap_s.png', angle: EM.HAPPY, name: 'happy' },
  { file: 'fc_coy_s.png', angle: EM.COY, name: 'coy' },
  { file: 'fc_bor_s.png', angle: EM.BORED, name: 'bored' },
  { file: 'fc_sca_s.png', angle: EM.SCARED, name: 'scared' },
  { file: 'fc_sad_s.png', angle: EM.SAD, name: 'sad' },
  { file: 'fc_ang_s.png', angle: EM.ANGRY, name: 'angry' },
  { file: 'fc_sho_s.png', angle: EM.SHOUT, name: 'shout' },
  { file: 'fc_laf_s.png', angle: EM.LAUGH, name: 'laugh' },
];

const NEUTRAL_FACE = 'fc_neu_s.png';

export class EmotionWheel {
  canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private images: HTMLImageElement[] = [];
  neutralImg: HTMLImageElement | null = null;
  private dragging = false;

  /** Current selection in polar space. */
  emotion: Emotion = { emotion: EM.NEUTRAL, intensity: 0 };
  /** Set while the user drags/holds a choice ("requested" in the original). */
  pinned = false;

  onChange: (em: Emotion, pinned: boolean) => void = () => {};

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.loadFaces();
    // Pointer events with capture: pointerup is guaranteed to arrive even
    // when released outside the window, so drags can't get stuck.
    // The original updates the self view live while dragging the bullseye
    // (CBodyCam::OnMouseMove → UpdateEmotion), so fire onChange throughout,
    // throttled to animation frames.
    let liveQueued = false;
    const liveChange = () => {
      if (liveQueued) return;
      liveQueued = true;
      requestAnimationFrame(() => {
        liveQueued = false;
        this.onChange(this.emotion, this.pinned);
      });
    };
    canvas.addEventListener('pointerdown', (e) => {
      canvas.setPointerCapture(e.pointerId);
      this.dragging = true;
      this.pick(e);
      liveChange();
    });
    canvas.addEventListener('pointermove', (e) => {
      if (this.dragging) {
        this.pick(e);
        liveChange();
      }
    });
    const end = () => {
      if (this.dragging) {
        this.dragging = false;
        this.onChange(this.emotion, this.pinned);
      }
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    canvas.addEventListener('lostpointercapture', end);
  }

  /** ResetAvatar equivalent: dot returns to the neutral center. */
  resetToNeutral() {
    this.pinned = false;
    this.emotion = { emotion: EM.NEUTRAL, intensity: 0 };
    this.draw();
  }

  private async loadFaces() {
    const load = (src: string) =>
      new Promise<HTMLImageElement>((res, rej) => {
        const img = new Image();
        img.onload = () => res(img);
        img.onerror = rej;
        img.src = src;
      });
    this.images = await Promise.all(FACES.map((f) => load(publicUrl(`ui/${f.file}`))));
    this.neutralImg = await load(publicUrl(`ui/${NEUTRAL_FACE}`));
    this.draw();
  }

  private geometry() {
    const s = this.canvas.width;
    const c = s / 2;
    const faceR = s / 2 - 10; // ring where faces sit
    const dotMax = faceR - 15; // white disc radius / drag range
    return { s, c, faceR, dotMax };
  }

  private pick(e: PointerEvent | MouseEvent) {
    const rect = this.canvas.getBoundingClientRect();
    const { c, dotMax } = this.geometry();
    const x = e.clientX - rect.left - c;
    const y = e.clientY - rect.top - c;
    const dist = Math.hypot(x, y);
    const intensity = Math.min(1, dist / dotMax);
    // GDI coordinates grow downward, so positive angles run clockwise.
    let angle = Math.atan2(y, x);
    if (angle < 0) angle += Math.PI * 2;
    if (intensity < 0.2) {
      this.emotion = { emotion: EM.NEUTRAL, intensity: 0 };
      this.pinned = true;
    } else {
      this.emotion = { emotion: angle, intensity };
      this.pinned = true;
    }
    this.draw();
  }

  setEmotion(em: Emotion, pinned: boolean) {
    this.emotion = em;
    this.pinned = pinned;
    this.draw();
  }

  draw() {
    const { s, c, faceR, dotMax } = this.geometry();
    const ctx = this.ctx;
    ctx.clearRect(0, 0, s, s);

    // Gray pane with the white "bullseye" disc (CBodyCam::DrawBullsEye).
    ctx.fillStyle = '#c0c0c0';
    ctx.fillRect(0, 0, s, s);
    ctx.beginPath();
    ctx.arc(c, c, dotMax + 5, 0, Math.PI * 2);
    ctx.fillStyle = 'white';
    ctx.fill();
    ctx.strokeStyle = '#808080';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Faces around the disc
    for (let i = 0; i < FACES.length; i++) {
      const img = this.images[i];
      if (!img) continue;
      const a = FACES[i].angle;
      const x = c + Math.cos(a) * faceR - img.width / 2;
      const y = c + Math.sin(a) * faceR - img.height / 2;
      ctx.drawImage(img, Math.round(x), Math.round(y));
    }

    // Selection: cross at neutral center, dot when set
    const { emotion, intensity } = this.emotion;
    if (emotion < 1000 && intensity > 0) {
      const dx = c + Math.cos(emotion) * intensity * dotMax;
      const dy = c + Math.sin(emotion) * intensity * dotMax;
      ctx.beginPath();
      ctx.arc(dx, dy, 3.5, 0, Math.PI * 2);
      ctx.fillStyle = 'black';
      ctx.fill();
    } else {
      ctx.strokeStyle = 'black';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(c - 4, c);
      ctx.lineTo(c + 4, c);
      ctx.moveTo(c, c - 4);
      ctx.lineTo(c, c + 4);
      ctx.stroke();
    }
  }
}
