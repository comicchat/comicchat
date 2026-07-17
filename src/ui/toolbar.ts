// Toolbars — the three original bars from chat.rc:
//   IDR_MAINFRAME (itoolbar.bmp), IDR_USERTOOLBAR (usertool.bmp),
//   IDR_TEXTTOOLBAR (texttool.bmp), each 16x16 cells.

import type { CommandRegistry } from './commands';
import { publicUrl } from '../public-url';
import { showContextMenu, type MenuEntry } from './menus';

interface TbButton {
  cmd?: string;
  sep?: boolean;
  icon?: number; // index into the strip
}

// itoolbar.bmp icon indexes (identified against the strip):
// 0 open, 1 save, 2 print, 3 connect, 4 disconnect, 5 enter room,
// 6 leave room, 7 create room, 8 comics view, 9 text view, 10 room list,
// 11 user list, 12 get identity, 13 whisper box, 14 ignore, 15 away,
// 16 send file, 17 search, 18 homepage, 19 favorites
const MAIN_BAR: TbButton[] = [
  { cmd: 'ID_SESSION_CONNECT', icon: 3 },
  { cmd: 'ID_SESSION_DISCONNECT', icon: 4 },
  { cmd: 'ID_SESSION_NEWROOM', icon: 5 },
  { cmd: 'ID_SESSION_LEAVE', icon: 6 },
  { cmd: 'ID_ROOM_CREATEROOM', icon: 7 },
  { sep: true },
  { cmd: 'ID_VIEW_COMICS', icon: 8 },
  { cmd: 'ID_VIEW_TEXT', icon: 9 },
  { sep: true },
  { cmd: 'ID_CHATROOM_LIST', icon: 10 },
  { cmd: 'ID_USER_LIST', icon: 11 },
  { sep: true },
  { cmd: 'ID_FAVORITES_OPENFAVORITES', icon: 19 },
];

// usertool.bmp: away, identity, ignore, whisper box, + extras
const MEMBER_BAR: TbButton[] = [
  { cmd: 'ID_AWAY_TOGGLE', icon: 0 },
  { cmd: 'ID_GETIDENTITY', icon: 1 },
  { cmd: 'ID_MEMBER_IGNORE', icon: 2 },
  { cmd: 'ID_WHISPERBOX_MLIST', icon: 3 },
];

// texttool.bmp: font, color, bold, italic, underline, fixed pitch, symbol
const TEXT_BAR: TbButton[] = [
  { cmd: 'ID_SETFONT', icon: 0 },
  { cmd: 'ID_SETCOLOR', icon: 1 },
  { cmd: 'ID_SWITCHBOLD', icon: 2 },
  { cmd: 'ID_SWITCHITALIC', icon: 3 },
  { cmd: 'ID_SWITCHUNDERLINED', icon: 4 },
  { cmd: 'ID_SWITCHFIXEDPITCH', icon: 5 },
  { cmd: 'ID_SWITCHSYMBOL', icon: 6 },
];

export class Toolbars {
  registry: CommandRegistry;
  visible = { main: true, member: true, text: true };
  private el: HTMLElement;

  constructor(el: HTMLElement, registry: CommandRegistry) {
    this.el = el;
    this.registry = registry;
    const saved = localStorage.getItem('comicchat-toolbars');
    if (saved) {
      try {
        this.visible = { ...this.visible, ...JSON.parse(saved) };
      } catch {
        /* ignore */
      }
    }
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const entries: MenuEntry[] = [
        { label: '&Main', cmd: 'ID_VIEW_TOOLBAR_MAIN' },
        { label: 'Membe&r', cmd: 'ID_VIEW_TOOLBAR_MEMBER' },
        { label: '&Text', cmd: 'ID_VIEW_TOOLBAR_TEXT' },
      ];
      showContextMenu(entries, registry, e.clientX, e.clientY);
    });
  }

  toggle(bar: 'main' | 'member' | 'text') {
    this.visible[bar] = !this.visible[bar];
    localStorage.setItem('comicchat-toolbars', JSON.stringify(this.visible));
    this.render();
  }

  render() {
    this.el.innerHTML = '';
    const bars: { key: 'main' | 'member' | 'text'; buttons: TbButton[]; strip: string }[] = [
      { key: 'main', buttons: MAIN_BAR, strip: publicUrl('ui/itoolbar.png') },
      { key: 'member', buttons: MEMBER_BAR, strip: publicUrl('ui/usertool.png') },
      { key: 'text', buttons: TEXT_BAR, strip: publicUrl('ui/texttool.png') },
    ];
    let first = true;
    for (const bar of bars) {
      if (!this.visible[bar.key]) continue;
      if (!first) {
        const gap = document.createElement('div');
        gap.className = 'tb-bargap';
        this.el.appendChild(gap);
      }
      first = false;
      const grip = document.createElement('div');
      grip.className = 'tb-grip';
      this.el.appendChild(grip);
      for (const b of bar.buttons) {
        if (b.sep) {
          const sep = document.createElement('div');
          sep.className = 'tb-sep';
          this.el.appendChild(sep);
          continue;
        }
        const btn = document.createElement('button');
        btn.className = 'tb-btn';
        btn.title = this.registry.tip(b.cmd!) || b.cmd!;
        btn.dataset.cmd = b.cmd;
        const enabled = this.registry.isEnabled(b.cmd!);
        const checked = this.registry.isChecked(b.cmd!);
        if (!enabled) btn.classList.add('tb-disabled');
        if (checked) btn.classList.add('active');
        const span = document.createElement('span');
        span.className = 'tb-icon' + (enabled ? '' : ' tb-icon-disabled');
        span.style.cssText = `background:url(${bar.strip}) -${(b.icon ?? 0) * 16}px 0;`;
        btn.appendChild(span);
        btn.onclick = () => this.registry.run(b.cmd!);
        this.el.appendChild(btn);
      }
    }
    if (this.el.childElementCount === 0) this.el.style.display = 'none';
    else this.el.style.display = '';
  }
}
