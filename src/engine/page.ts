// Page engine: panel sequencing (CUnitPanelPage::AddLine/AddReaction),
// page geometry (pageview.cpp) and canvas rendering.

import type { ArtStore } from '../art/store';
import { computeBodyGeometrySync, type AvatarState } from './avatar';
import { Balloon, makeFontInfo, type BalloonType, type FontInfo } from './balloon';
import type { TextSegment } from './richtext';
import { Panel, type Hysteresis, type PanelContext } from './panel';
import {
  INTERSTICE, MIN_UNIT_PANEL_WIDTH, PANEL_BORDER_WIDTH, TWIPS_PER_PX,
  BALLOON_FONT_TWIPS, MAX_PANEL_BALLOONS, MAX_PANEL_BODIES,
} from './twips';

export interface PageMember {
  key: string;
  nick: string;
  avatar: AvatarState;
  talkTos: string[];
}

export class Page {
  art: ArtStore;
  panels: Panel[] = [];
  unitWidth = MIN_UNIT_PANEL_WIDTH;
  panelsPerRow = 2;
  backgroundId: string | null = 'room';
  private newPanelFlag = false;
  private hysteresis = new Map<string, Hysteresis>();
  private members = new Map<string, PageMember>();
  fontNormal: FontInfo;
  fontWhisper: FontInfo;
  onLayout: () => void = () => {};

  constructor(art: ArtStore) {
    this.art = art;
    this.fontNormal = makeFontInfo(BALLOON_FONT_TWIPS, false);
    this.fontWhisper = makeFontInfo(BALLOON_FONT_TWIPS, true);
  }

  setMember(m: PageMember) {
    this.members.set(m.key, m);
  }

  removeMember(key: string) {
    this.members.delete(key);
  }

  private ctx(): PanelContext {
    return {
      unitWidth: this.unitWidth,
      unitHeight: this.unitWidth, // square panels
      hysteresis: (key) => {
        let h = this.hysteresis.get(key);
        if (!h) {
          h = { lastDir: false, lastLeft: null, lastRight: null };
          this.hysteresis.set(key, h);
        }
        return h;
      },
      talkTos: (key) => this.members.get(key)?.talkTos ?? [],
      avatarOf: (key) => this.members.get(key)?.avatar ?? null,
      nickOf: (key) => this.members.get(key)?.nick ?? key,
    };
  }

  /** pageview.cpp GetProspectivePanelWidth: square panels sized so
   *  panelsPerRow fit the view width exactly (gutters between panels only). */
  setViewWidth(viewWidthPx: number, viewHeightPx: number) {
    const xWidth = Math.ceil(viewWidthPx * TWIPS_PER_PX);
    let goal = Math.floor((xWidth + INTERSTICE * (1 - this.panelsPerRow)) / this.panelsPerRow);
    const yHeight = Math.ceil(viewHeightPx * TWIPS_PER_PX);
    const nHigh = Math.max(1, Math.ceil((yHeight + INTERSTICE) / (goal + INTERSTICE)));
    const goalPanelHeight = Math.floor((yHeight + INTERSTICE * (1 - nHigh)) / nHigh);
    goal = Math.min(goal, goalPanelHeight);
    this.unitWidth = Math.max(goal, MIN_UNIT_PANEL_WIDTH);
  }

  setPanelsPerRow(n: number, viewWidthPx: number, viewHeightPx: number) {
    this.panelsPerRow = Math.max(1, n);
    this.setViewWidth(viewWidthPx, viewHeightPx);
  }

  startNewPanel() {
    this.newPanelFlag = true;
  }

  /** Establishing(): first couple of panels get wide shots. */
  private establishing(newedPanel: boolean): boolean {
    const count = this.panels.length;
    return count <= 1 || (!newedPanel && count <= 2);
  }

  /** CUnitPanelPage::AddLine */
  addLine(memberKey: string, text: string | TextSegment[], kind: BalloonType) {
    const member = this.members.get(memberKey);
    if (!member) return;

    if (kind === 'box' || kind === 'whisperbox') this.startNewPanel();

    let newedPanel = false;
    const last = this.panels[this.panels.length - 1] as Panel | undefined;
    let panel: Panel;
    let replaceLast = false;

    if (
      this.newPanelFlag || !last ||
      last.balloons.length >= MAX_PANEL_BALLOONS ||
      this.panels.length < 2 ||
      last.hasMember(memberKey)
    ) {
      panel = new Panel(this.backgroundId);
      this.newPanelFlag = false;
      newedPanel = true;
    } else {
      panel = last.clone();
      replaceLast = true;
    }

    const ctx = this.ctx();
    const font = kind === 'whisper' || kind === 'whisperbox' ? this.fontWhisper : this.fontNormal;
    const balloon = new Balloon(kind, text, font);
    panel.fetchSpeaker(memberKey, ctx);
    balloon.speaker = { arrowX: 0, bboxTop: 0, key: memberKey };
    panel.balloons.push(balloon);
    panel.replaceBody(memberKey, ctx);

    panel.layoutAvatars(ctx, this.establishing(newedPanel));
    // sync speaker ref post-layout
    const placed = panel.bodies.find((b) => b.memberKey === memberKey);
    if (placed) {
      balloon.speaker.arrowX = placed.arrowX;
      balloon.speaker.bboxTop = placed.bbox.top;
    }

    if (!panel.layoutBalloons(ctx)) {
      // didn't fit: leave the old panel alone, start fresh with this line
      this.startNewPanel();
      this.addLine(memberKey, text, kind);
      return;
    }

    if (replaceLast) this.panels.pop();
    this.panels.push(panel);

    // avatar returns to neutral after speaking (ResetAvatar, unless frozen)
    member.avatar.recordBody(member.avatar.body);
    if (!member.avatar.frozen) member.avatar.body = member.avatar.neutralBody();

    // force-fit leftover → continue in a new panel
    const rest = panel.balloons[panel.balloons.length - 1].rest;
    if (rest) {
      this.startNewPanel();
      this.addLine(memberKey, rest, kind);
      return;
    }

    this.onLayout();
  }

  /** CUnitPanelPage::AddReaction — pose change without text (<Chr>). */
  addReaction(memberKey: string) {
    const member = this.members.get(memberKey);
    if (!member) return;
    const last = this.panels[this.panels.length - 1] as Panel | undefined;
    let panel: Panel;
    let replaceLast = false;
    if (this.newPanelFlag || !last || last.bodies.length >= MAX_PANEL_BODIES || this.panels.length < 2) {
      panel = new Panel(this.backgroundId);
      this.newPanelFlag = false;
    } else {
      panel = last.clone();
      replaceLast = true;
    }
    const ctx = this.ctx();
    if (!panel.replaceBody(memberKey, ctx)) panel.fetchSpeaker(memberKey, ctx);
    panel.layoutAvatars(ctx, this.establishing(false));
    if (!panel.layoutBalloons(ctx)) {
      this.startNewPanel();
      this.addReaction(memberKey);
      return;
    }
    if (replaceLast) this.panels.pop();
    this.panels.push(panel);
    this.onLayout();
  }

  // -------------------------------------------------------------------------
  // Rendering

  /** Page pixel height for the current width/panel count. */
  layoutHeightPx(_viewWidthPx: number): number {
    const rows = Math.max(1, Math.ceil(this.panels.length / this.panelsPerRow));
    const unitPx = this.unitWidth / TWIPS_PER_PX;
    const gapPx = INTERSTICE / TWIPS_PER_PX;
    return Math.ceil(rows * (unitPx + gapPx));
  }

  async render(ctx2d: CanvasRenderingContext2D, _viewWidthPx: number) {
    const unitPx = this.unitWidth / TWIPS_PER_PX;
    const gapPx = INTERSTICE / TWIPS_PER_PX;

    ctx2d.fillStyle = 'white';
    ctx2d.fillRect(0, 0, ctx2d.canvas.width, ctx2d.canvas.height);

    for (let i = 0; i < this.panels.length; i++) {
      const col = i % this.panelsPerRow;
      const row = Math.floor(i / this.panelsPerRow);
      const px = 1 + col * (unitPx + gapPx);
      const py = 1 + row * (unitPx + gapPx);
      await this.renderPanel(ctx2d, this.panels[i], px, py, unitPx);
    }
  }

  private async renderPanel(g: CanvasRenderingContext2D, panel: Panel, px: number, py: number, unitPx: number) {
    const scale = 1 / TWIPS_PER_PX; // twips → px
    // panel-space (x right, y up from top edge at 0) → canvas
    const toCanvas = (x: number, y: number): [number, number] => [px + x * scale, py - y * scale];

    g.save();
    g.beginPath();
    g.rect(px, py, unitPx, unitPx);
    g.clip();

    // Backdrop (CBackDrop::Draw): the backdrop box is a SOURCE WINDOW into
    // the image, expressed as a fraction of the panel; the window stretches
    // to fill the panel (zoom-in shows a smaller window, i.e. bigger art).
    g.fillStyle = 'white';
    g.fillRect(px, py, unitPx, unitPx);
    if (panel.backgroundId) {
      const bg = await this.art.background(panel.backgroundId);
      if (bg && panel.backdropBox) {
        const b = panel.backdropBox;
        const unitW = this.unitWidth;
        const bitW = bg.width, bitH = bg.height;
        // fractions of panel → source pixels (y-up: top=delta, bottom=-logH+delta)
        const srcLeft = Math.round((b.left / unitW) * bitW);
        const srcRight = Math.round((b.right / unitW) * bitW);
        const srcTop = Math.round((b.top / -unitW) * bitH);
        const srcBottom = Math.round((b.bottom / -unitW) * bitH);
        const srcW = srcRight - srcLeft;
        const srcH = srcBottom - srcTop;
        if (srcW > 0 && srcH > 0) {
          const sX = unitPx / srcW;
          const sY = unitPx / srcH;
          g.drawImage(bg, px - srcLeft * sX, py - srcTop * sY, bitW * sX, bitH * sY);
        }
      }
    }

    // bodies
    for (const b of panel.bodies) {
      const geo = b.avatar ? computeBodyGeometrySync(b.avatar, b.body, b.flip) : null;
      if (!geo) continue;
      const [bx, byTop] = toCanvas(b.bbox.left, b.bbox.top);
      const bodyScalePx = (b.bbox.top - b.bbox.bottom) / geo.height * scale;
      g.save();
      g.translate(bx, byTop);
      g.scale(bodyScalePx, bodyScalePx);
      if (b.flip) {
        g.translate(geo.width, 0);
        g.scale(-1, 1);
      }
      g.drawImage(geo.torsoPose.img, geo.torsoPos.x, geo.torsoPos.y);
      if (geo.headPose && geo.headPos) g.drawImage(geo.headPose.img, geo.headPos.x, geo.headPos.y);
      g.restore();
    }

    // balloons: latest drawn first so earlier ones sit on top
    for (let i = panel.balloons.length - 1; i >= 0; i--) {
      panel.balloons[i].draw(g, scale, toCanvas);
    }

    g.restore();

    // border (120-twip pen centered on the edge, half visible)
    if (panel.hasBorder) {
      g.strokeStyle = 'black';
      g.lineWidth = (PANEL_BORDER_WIDTH * 2 * scale) / 2;
      g.strokeRect(px + 0.5, py + 0.5, unitPx - 1, unitPx - 1);
    }
  }
}
