# Comic Chat for the Web

A faithful web port of **Microsoft Comic Chat** (1996–1998), built from the
[original source release](https://github.com/microsoft/comic-chat) —
the comic engine, the art pipeline, and the IRC protocol, running entirely
in the browser.

![Microsoft Chat](sources/comic-chat/v2.5-beta-1/readme.gif)

## What's faithful

- **The original art**, extracted from the shipped `.avb`/`.bgb` binaries:
  31 characters and 9 backgrounds by **Jim Woodring**, decoded from the
  zlib-compressed masked-DIB format into PNGs by `tools/extract-avb.mjs`.
- **The comic engine** (`src/engine/`), ported function-by-function from the
  1998 C++ (`panel.cpp`, `balloon.cpp`, `spline.cpp`, `avatar.cpp`):
  - panel composition: clone-and-extend, 5-balloon/5-body limits, speaker
    re-entry breaks, establishing shots, zoom with head-room protection;
  - greedy character placement with facing penalties and left/right
    hysteresis; characters flip to face who they talk to;
  - balloon outlines as **beta-splines** (tension 5, bias 1) around per-line
    text "filters" with wavy bumps every 300 twips; tails broken into the
    outline with paired arcs; think-bubble chains; dashed whispers; action
    boxes — all in the original MM_TWIPS coordinate system;
  - the text-to-emotion **expert system** with the authentic rule table from
    the original string resources (ALL CAPS → shout at strength 9, `LOL` →
    laugh at 11, `:-)` → happy at 10, sentence-initial `You` → point, …);
  - the emotion wheel: 8 emotions at 45° steps, radius = intensity, mapped to
    the nearest face/torso records exactly like `GetBodyFromEmotion`.
- **The wire protocol** (`src/irc/protocol.ts`): messages carry the original
  annotation prefix `(#G<t><te><ti>E<f><fe><fi>[R]M<m>[T…]) text`, characters
  announce with `# Appears as <name>`, backgrounds sync with `# BDrop2:` —
  interoperable with original Comic Chat clients on the same IRC server.

## Running it

```sh
npm install
npm run extract-art   # one-time: decode .avb/.bgb art into public/art
npm run dev           # http://localhost:5885
```

The art extraction expects the original sources checkout under
`sources/comic-chat` (this repo layout). `tools/extract-ui.mjs` converts the
`res/*.bmp` UI resources (emotion faces, toolbar strips).

## Connecting

Everything is client-side; there is no backend. Two modes:

- **Demo room** — offline, scripted characters. Zero network.
- **IRC over WebSocket** — connects straight from the browser to any IRC
  server with a WebSocket listener (Ergo, UnrealIRCd 5+, InspIRCd 3+, or a
  webircgateway in front of anything else).

To run a local [Ergo](https://ergo.chat) server for testing, enable a
websocket listener in its config:

```yaml
server:
  listeners:
    "127.0.0.1:8067":
      websocket: true
  websockets:
    allowed-origins: ["*"]
```

then point the connect dialog at `ws://localhost:8067`.

## Layout

```
src/engine/   the comic engine port (twips, splines, balloons, panels, page)
src/irc/      gamja-based IRC core + Comic Chat wire protocol + demo room
src/art/      runtime art store (extracted characters/backgrounds)
src/ui/       98.css chrome: menus, dialogs, wheel, roster
tools/        build-time extractors for the original binary art
docs/         engine notes reverse-engineered from the 1998 sources
```

## Licensing

- Port code: MIT.
- `src/irc/gamja/` is vendored from [gamja](https://codeberg.org/emersion/gamja)
  (AGPL-3.0-or-later) — the combined web app is effectively AGPL; see
  `src/irc/gamja/LICENSE`.
- Original Comic Chat sources and art: MIT, © Microsoft Corporation
  (from the [microsoft/comic-chat](https://github.com/microsoft/comic-chat)
  release; keep a checkout under `sources/comic-chat` to re-run the art
  extraction). Character art by Jim Woodring.
