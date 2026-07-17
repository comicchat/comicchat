# Comic Chat engine notes (from v2.5-beta-1 sources)

Reverse-engineering notes used for the web port. References are to files in
`sources/comic-chat/v2.5-beta-1/`.

## Coordinate system

Everything renders in **MM_TWIPS** (1440/inch, 1/20 pt): x grows right,
y grows **up** — panel-space rectangles run from `top = 0` down to
`bottom = -unitHeight`. At 96 DPI, 1 px = 15 twips.

- Panels are square: `unitWidth = unitHeight`, chosen so N panels fit the view
  width (`pageview.cpp GetProspectivePanelWidth`), min 2300 twips.
- Gutters (`interstice`) 144 twips; panel border pen 120 twips wide (half
  clipped outside the panel edge), `panel.cpp:64`.

## AVB file format (avbfile.h/.cpp)

- Header: `u16 magic (0x81|0x8181), u16 type (1 simple/2 complex/3 backdrop), u16 version`.
- Tag stream, `u16 tag` (+ `u16 size` for tags >= 256), until `AK_STARTDATA=6`.
  Records: name(1), flags(2), icon(3), faces(4/10), torsos(5/11), bodies(9/12),
  style(8), iconNew(256), palette(257: u16 n + n×RGB), backdrop(258),
  copyright(259), urls(260/261), usage(262), offsetAdjust(263).
- FACE/TORSO/BODY records: `u32 img/mask/aura offsets, u16 emotionIndex,
  u8 intensity, [cx cy (+cxDelta cyDelta) | x y as i16] + 3 fmt + 3 palette
  bytes` (old tags: same layout inside 16 pad bytes). Consecutive records with
  equal image offset share the pose ("ditto").
- Emotion index → `emFloats[]` (avatario.cpp): 1-8 wheel angles (i·2π/8 from
  happy), 9 neutral, 10-17 gestures (wave, pointother, pointself, doublepoint,
  shrug, 3 walks). Intensity byte /255.
- Images: `AIF_DIB` = embedded BMP; `AIF_LZDEFLATE` = optional local palette
  record + `i32 biSize + rest-of-BITMAPINFOHEADER + u32 rawSize + u32 zSize +
  zlib data`. Palette types: none/global/local/mono/maskedmono/dualmask.
- MASKEDMONO 2bpp pairs (bit1=a → mask, bit0=b → image, aura = a|b); the
  image DIB palette is index0=WHITE index1=BLACK, so pair 10 = white pixel,
  11 = black pixel (the avbfile.h comment names them backwards). 00 blank,
  01 aura. DUALMASK: bit0 = transparency mask, bit1 = aura mask (1 = opaque).
- Head/torso assembly (`avatar.cpp CBodyDouble::GetDimInfo`):
  `offset = (torso.cx + face.cxDelta − face.cx, torso.cy + face.cyDelta − face.cy)`
  in y-down bitmap coords, torso at origin; composite box = union; `headHeight`
  = head bottom edge; `faceX/faceY` = face record x/y (+offset), mirrored by
  flip.

## Pose selection (avatar.cpp)

- Wheel/single emotion → nearest face by |Δangle| (ties: nearest intensity);
  torso search rotates from `lastTorso+1`, requires Δangle < π/8, skips
  gesture records (emotion > 7 rad), neutral fallback.
- `CEmotionOpts` (≤10 options with priorities): process in descending
  priority; first hit fills face, first hit fills torso
  (`GetHeadAndBodyFromEmotion`: emotion ≤ 2π → face search; gesture values →
  exact-match torso search). Neutral fallback rotates from last used.
- Incoming wire indices apply directly (`SetIndices`) when the receiver has
  the sender's character; if remapped (`OTHERMAPPED`), the emotion bytes are
  used through `SetEmotions` instead.

## Text semantics (textpose.cpp + chat.rc string resources)

Rules are data (`ID_RULE_*` strings): `Function("arg");Strength` lines.
Functions: AllCaps, FindString[*], CheckWord[*], CheckStart[*] (* = case
insensitive; CheckWord = whole word; CheckStart = sentence start, sentences
split on `.!?`). All add intensity 1.0. Authentic table:

- SHOUT: AllCaps;9 · FindString "!!!";9
- LAUGH: CheckWord* ROTFL;11 · LOL;11 · FindString* HEHE;11
- HAPPY: FindString ":)";10 · ":-)";10
- SAD: ":(" ;10 · ":-(";10
- COY: ";-)";10 · ";)";10
- POINTOTHER: CheckStart* You;4 · CheckWord* "are|will|did|aren't|don't you";8
- POINTSELF: CheckStart* I;3 · CheckWord* "i'm|i will|i'll|i am";7
- WAVE: CheckStart* Hi;2 · Bye;3 · Hello;5 · Welcome;5 · Howdy;5

`CEmotionOpts::Add` keeps the higher priority for duplicate emotions.
Semantics run on the **sender**; results ride the wire as pose indices.

## Wire protocol (protsupp.cpp, ircproto.h)

- Channel/whisper text: `PRIVMSG target :(#G<t><te><ti>E<f><fe><fi>[R]M<m>[T<n1,n2>]) text`
  (all values +0x30; G=torso record index/emotion idx/intensity·10, E=face,
  R=user-requested, M mode: 1 say 2 whisper 3 think 5 action; T addressees).
  On IRCX servers the same payload goes via `DATA target CCUDI1 :#G…`.
- `#`-commands: `# Appears as <char>[, <url>]`, `# GetCharInfo`, `# GetInfo`,
  `# HeresInfo: …`, `# BDrop: <name>` / `# BDrop2: <name>[, url]` (ops only).
- Actions are CTCP ACTION; private messages force whisper mode on receive.

## Panel construction (panel.cpp)

`AddLine(speaker, text, mode)`:
1. Actions (`BM_ACTION`) force a new panel.
2. New panel if: flagged, last panel has ≥5 balloons, <2 panels exist, or the
   speaker is already **present** in the last panel. Otherwise **clone the
   last panel, add the balloon, re-layout, and swap it in place**.
3. Speaker body = clone of the avatar's current body (from wire indices /
   local semantics); `ReplaceBody` refreshes it and marks it requested.
4. If balloons don't fit → discard attempt, start fresh panel, recurse.
   A single over-tall balloon is force-fit and split; the remainder recurses
   with "..." continuations both sides.
5. After a successful add, the avatar resets to neutral (unless frozen).

`LayoutAvatars`:
- Keep speakers (balloon owners / requested); if <5 bodies, add `talkTos`
  listeners at neutral (max 5 total).
- Greedy ordering: insert each body at the position/flip minimizing penalties
  (`EvalPair`): facing-partner +4·(distance−1) if facing, +40 if facing away,
  +4 partner facing away; world-talkers +4/+2; plus +1 per changed neighbor vs
  `lastLeft/lastRight` (hysteresis); ties keep `lastDir`. flip=false faces
  right.
- Scale so tallest body = `unitHeight/1.9` (normHeight equal → same height),
  bottoms on the panel floor; if too wide, shrink all to fit.
  Else if not establishing (first 1-2 panels of a page) zoom in by
  `min(unitWidth/sumWidth, maxBodyHeight/(1.2·maxHeadHeight))` (≥1.1 else 1):
  bodies grow (tops fixed pre-zoom → feet crop below panel), backdrop box
  scales by 1/zoom around the head line.
- Even margins: `(unitWidth − ΣW)/(n+1)`; `arrowX` = face-x fraction × width.

`LayoutBalloons` (seeded per panel — layout is deterministic per panel):
- Free rect = top half of panel inset by border.
- Width estimate: one line if text ≤500 twips; else
  `minWidth = area/potentialHeight` (≥ widest word), random up to max width;
  clamp to len+200/max. X: random in `[arrowX−w, arrowX]`, clamped — a balloon
  always overlaps its speaker's arrowX; boxes go at the left edge.
- X shifted/clamped into the intersection of previous balloons' route
  allowances (`QueryRouteRgn`: keep ≥300 twips of route, allowance opens away
  from the other tail); top = min(panel top, tops of clouds right of us,
  bottoms − 90 of overlapping clouds) → stacking; snap to top if within
  250 twips. Route regions of previous balloons shrink to exclude ours.
- Fail (tail room < 100 twips) → panel overflow.

## Balloons (balloon.cpp, spline.cpp, fonts.cpp)

- Text is **capitalized**; wrapped ≤10 lines. Font: user LOGFONT (default
  Comic Sans MS, 180 twips ≈ 9 pt); whisper adds italic; leading −40/+30
  tweak for Comic Sans; shout font 252 twips scaled by panel/4860.
- Outline: staircase "filters" of per-line extents (merge lines whose edges
  differ dramatically: thresholds ±70), inflated by XBORDER=100/YBORDER=40,
  TOPBORDER=−20; wavy points every 300 twips bumped 70 twips outward
  (alternating); closed **beta-spline** (tension 5, bias 1) → cubic Béziers.
- Tail: spline broken at a 160-twip gap near the last line under `xbreak`
  (route-region midpoint pulled toward the text edge ±150/350, angle capped
  45°); two arcs (altitude ±5% of length) from gap edges to
  `(speaker.arrowX, speaker.top + 200)`, min height 100.
- Think: same cloud, no tail; ellipse bubbles along that line: height 150,
  gap 100, first at half-height from the body end, widths growing to 400.
- Whisper: stroke cloud with 100-twip white pen, fill white, then dash black
  28-twip pen, 100 on/100 off (manhattan distance).
- Say pen: 28 twips black; fill white. Box (actions): plain rect XBOXDELTA=90 /
  YBOXDELTA=50 around text, left-justified, text = "Nick action text",
  whisper-boxes dashed.
- Draw order in panel: backdrop, bodies, then balloons **latest first** (so
  earlier balloons overlap later ones); border last.

## Misc

- Whispers appear only in the sender's and recipients' views.
- `# BDrop` changes the room backdrop (ops only).
- Balloon text color: `theApp.m_comicsColor` (default black).
- Member list: 2-column icon grid; bullseye emotion wheel: 8 faces at 45°,
  white disc, black dot, drag to set (angle=emotion, radius=intensity).
