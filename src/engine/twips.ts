// Coordinate system: the original renders in MM_TWIPS (y-up, 1440/inch).
// We keep all layout math in twips and map to canvas pixels at draw time.

export const TWIPS_PER_PX = 15; // 1440 twips/inch ÷ 96 px/inch

// panel.cpp / pageview.cpp
export const MIN_UNIT_PANEL_WIDTH = 2300;
export const INTERSTICE = 144;          // gap between panels (h and v)
export const PANEL_BORDER_WIDTH = 60;   // half of the 120-twip border pen shows
export const MAXBDYPERFRAME = 20;
export const MAX_PANEL_BODIES = 5;      // AddTalkTos cap + AddReaction check
export const MAX_PANEL_BALLOONS = 5;    // AddLine check (m_elements >= 5)
export const ONELINETHRESHOLD = 500;
export const MINHOOKHEIGHT = 100;

// balloon.cpp
export const XBOXDELTA = 90;
export const YBOXDELTA = 50;
export const BUBBLEHEIGHT = 150;
export const INTERBUBBLE = 100;
export const ENDBUBBLEWIDTH = 400;
export const VWAVEHEIGHT = 70;
export const VWAVEINTERVAL = 300;
export const HWAVEHEIGHT = 70;
export const HWAVEINTERVAL = 300;
export const XBORDER = 100;
export const YBORDER = 40;
export const TOPBORDER = -20;
export const THRESH1 = -70;
export const THRESH2 = 70;
export const LARGEDELTA = 350;
export const SMALLDELTA = 150;
export const MINTAILHEIGHT = 100;
export const MINROUTEWIDTH = 300;
export const MAXLINES = 10;
export const BALLOON_PEN = 28;          // say/think/box outline width
export const NIMBUS_PEN = 100;          // whisper white halo pen
export const DASH_ON = 100;
export const DASH_OFF = 100;
export const TAIL_GAP_HALF = 80;        // BreakSpline gap half-width
export const DOCK_SNAP = -250;          // DockAtTop threshold (bbox.Top >)
export const SPEAKER_TAIL_DROP = 200;   // tail target: speaker top + 200 (y-up)

// fonts.cpp
export const BALLOON_FONT_TWIPS = 180;  // 9pt default
export const SHOUT_FONT_TWIPS = 252;    // nFontHeightShout (-252), scaled by unitWidth/4860
export const TITLE_FONT_TWIPS = 576;
export const FONT_REFERENCE_PANEL = 4860;
export const BALLOON_FONT_FAMILY = '"Comic Sans MS", "Comic Neue", "Comic Relief", cursive';

export const LARGEINTEGER = 0x7fffffff;

export interface SRect { left: number; bottom: number; right: number; top: number } // y-up: top > bottom
export interface Pt { x: number; y: number }
