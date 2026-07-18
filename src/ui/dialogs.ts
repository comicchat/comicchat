// 98.css-styled dialogs. The Chat Connection dialog mirrors the original's
// tabbed layout: Connect | Personal Info | Character | Background.

import type { ArtStore } from '../art/store';
import { AvatarState, computeBodyGeometry, drawBody } from '../engine/avatar';

function dialogFrame(title: string): {
  overlay: HTMLElement;
  body: HTMLElement;
  buttons: HTMLElement;
  close: () => void;
} {
  const overlay = document.createElement('div');
  overlay.className = 'dialog-overlay';
  const win = document.createElement('div');
  win.className = 'window';
  const bar = document.createElement('div');
  bar.className = 'title-bar';
  bar.innerHTML = `<div class="title-bar-text"></div>
    <div class="title-bar-controls"><button aria-label="Close"></button></div>`;
  bar.querySelector('.title-bar-text')!.textContent = title;
  const body = document.createElement('div');
  body.className = 'dialog-body';
  const buttons = document.createElement('div');
  buttons.className = 'dialog-buttons';
  win.append(bar, body, buttons);
  overlay.appendChild(win);
  document.body.appendChild(overlay);
  makeDraggable(win, bar);
  const close = () => overlay.remove();
  (bar.querySelector('button[aria-label="Close"]') as HTMLButtonElement).onclick = close;
  return { overlay, body, buttons, close };
}

/** Let a window be dragged by its title bar. The offset is applied as a
 *  transform so the flex-centred starting position is preserved. */
function makeDraggable(win: HTMLElement, handle: HTMLElement) {
  let offX = 0;
  let offY = 0; // committed offset from the centred position
  let startX = 0;
  let startY = 0;
  let baseX = 0;
  let baseY = 0;
  const onMove = (e: PointerEvent) => {
    win.style.transform = `translate(${baseX + e.clientX - startX}px, ${baseY + e.clientY - startY}px)`;
  };
  const onUp = (e: PointerEvent) => {
    offX = baseX + e.clientX - startX;
    offY = baseY + e.clientY - startY;
    handle.removeEventListener('pointermove', onMove);
    handle.removeEventListener('pointerup', onUp);
  };
  handle.addEventListener('pointerdown', (e: PointerEvent) => {
    // Don't start a drag on the title-bar buttons (Close, etc.).
    if (e.button !== 0 || (e.target as HTMLElement).closest('.title-bar-controls')) return;
    startX = e.clientX;
    startY = e.clientY;
    baseX = offX;
    baseY = offY;
    handle.setPointerCapture(e.pointerId);
    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onUp);
    e.preventDefault();
  });
}

export interface ConnectChoice {
  url: string;
  nick: string;
  realname: string;
  email: string;
  homepage: string;
  profile: string;
  channel: string;
  action: 'room' | 'list' | 'connectonly';
  characterId: string;
  backgroundId: string;
}

const PRESETS = [
  { label: 'Local ergo (ws://localhost:8067)', url: 'ws://localhost:8067' },
  { label: 'Libera.Chat (wss://web.libera.chat)', url: 'wss://web.libera.chat/webirc/websocket/' },
  { label: 'Ergo testnet (wss://testnet.ergo.chat)', url: 'wss://testnet.ergo.chat/webirc' },
];

const LS_KEY = 'comicchat-prefs';

export function loadPrefs(): Partial<ConnectChoice> {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) ?? '{}');
  } catch {
    return {};
  }
}

function savePrefs(p: Partial<ConnectChoice>) {
  localStorage.setItem(LS_KEY, JSON.stringify(p));
}

export function showConnectDialog(
  art: ArtStore,
  characterIds: string[],
  backgroundIds: string[],
  favorites: FavoriteRoom[],
  defaults: Partial<ConnectChoice>,
  initialTab: 'connect' | 'character' | 'background' = 'connect',
): Promise<ConnectChoice | null> {
  return new Promise((resolve) => {
    const prefs = { ...loadPrefs(), ...defaults };
    const { body, buttons, close } = dialogFrame('Chat Connection');
    body.classList.add('cd-body');
    body.innerHTML = `
      <menu role="tablist">
        <li role="tab" data-tab="connect"><a href="#">Connect</a></li>
        <li role="tab" data-tab="personal"><a href="#">Personal Info</a></li>
        <li role="tab" data-tab="character"><a href="#">Character</a></li>
        <li role="tab" data-tab="background"><a href="#">Background</a></li>
      </menu>
      <div class="tab-panel" data-panel="connect">
        <p class="cd-welcome">Welcome to Microsoft Chat.  You can specify chat
          server connection information here, and optionally adjust your Personal
          Information from the next tab.</p>
        <div class="field-row-stacked">
          <label for="cd-fav">Favorites:</label>
          <select id="cd-fav"></select>
        </div>
        <div class="field-row-stacked">
          <label for="cd-url">Server:</label>
          <input id="cd-url" type="text" list="cd-server-presets" autocomplete="off">
          <datalist id="cd-server-presets">
            ${PRESETS.map((p) => `<option value="${p.url}">${p.label}</option>`).join('')}
          </datalist>
        </div>
        <hr class="cd-sep">
        <div class="field-row">
          <input id="cd-act-room" type="radio" name="cd-action">
          <label for="cd-act-room">Go to chat room:</label>
          <input id="cd-chan" type="text" class="cd-chan-input">
        </div>
        <div class="field-row">
          <input id="cd-act-list" type="radio" name="cd-action">
          <label for="cd-act-list">Show all available chat rooms</label>
        </div>
        <div class="field-row">
          <input id="cd-act-only" type="radio" name="cd-action">
          <label for="cd-act-only">Just connect to server</label>
        </div>
      </div>
      <div class="tab-panel" data-panel="personal" hidden>
        <div class="field-row-stacked">
          <label for="cd-realname">Real name:</label>
          <input id="cd-realname" type="text" maxlength="60">
        </div>
        <div class="field-row-stacked">
          <label for="cd-nick">Nickname:</label>
          <input id="cd-nick" type="text" maxlength="32">
        </div>
        <div class="field-row-stacked">
          <label for="cd-email">E-mail address:</label>
          <input id="cd-email" type="text">
        </div>
        <div class="field-row-stacked">
          <label for="cd-homepage">WWW Home Page:</label>
          <input id="cd-homepage" type="text">
        </div>
        <div class="field-row-stacked">
          <label for="cd-profile">Brief description of yourself:</label>
          <textarea id="cd-profile" rows="3"></textarea>
        </div>
      </div>
      <div class="tab-panel" data-panel="character" hidden>
        <div class="cd-char-layout">
          <div class="cd-char-list-wrap">
            <label>Character:</label>
            <select id="cd-char-list" size="12"></select>
          </div>
          <div class="cd-char-preview-wrap">
            <label>Preview:</label>
            <canvas id="cd-char-preview" width="160" height="170"></canvas>
          </div>
        </div>
        <div id="cd-char-copyright" class="cd-copyright"></div>
      </div>
      <div class="tab-panel" data-panel="background" hidden>
        <div class="cd-char-layout">
          <div class="cd-char-list-wrap">
            <label>Background:</label>
            <select id="cd-bg-list" size="12"></select>
          </div>
          <div class="cd-char-preview-wrap">
            <label>Preview:</label>
            <canvas id="cd-bg-preview" width="170" height="170"></canvas>
          </div>
        </div>
      </div>`;

    const $ = <T extends HTMLElement = HTMLInputElement>(id: string) =>
      body.querySelector<T>(`#${id}`)!;

    // tabs
    const tabs = [...body.querySelectorAll<HTMLLIElement>('menu[role=tablist] li')];
    const panels = [...body.querySelectorAll<HTMLElement>('.tab-panel')];
    const selectTab = (name: string) => {
      for (const t of tabs) t.setAttribute('aria-selected', String(t.dataset.tab === name));
      for (const p of panels) p.hidden = p.dataset.panel !== name;
    };
    for (const t of tabs) {
      t.addEventListener('click', (e) => {
        e.preventDefault();
        selectTab(t.dataset.tab!);
      });
    }
    selectTab(initialTab);

    // connect tab state
    const urlInput = $('cd-url');
    urlInput.value = prefs.url ?? PRESETS[0].url;
    const chanInput = $('cd-chan');
    chanInput.value = prefs.channel ?? '#comicchat';

    // connect action radios (Go to room / list all rooms / just connect)
    const actRoom = $('cd-act-room');
    const actList = $('cd-act-list');
    const actOnly = $('cd-act-only');
    const action = prefs.action ?? 'room';
    (action === 'list' ? actList : action === 'connectonly' ? actOnly : actRoom).checked = true;
    const syncAction = () => {
      chanInput.disabled = !actRoom.checked;
    };
    for (const r of [actRoom, actList, actOnly]) r.onchange = syncAction;
    syncAction();

    // Favorites combo: choose a saved room to fill Server + room.
    const favSelect = $<HTMLSelectElement>('cd-fav');
    favSelect.appendChild(new Option('(select a favorite)', ''));
    favorites.forEach((f, i) => {
      favSelect.appendChild(new Option(favoriteLabel(f), String(i)));
    });
    favSelect.onchange = () => {
      const f = favorites[Number(favSelect.value)];
      if (!f) return;
      urlInput.value = f.url;
      chanInput.value = f.channel;
      actRoom.checked = true;
      syncAction();
    };

    // personal info
    $('cd-nick').value = prefs.nick ?? `WebGuest${Math.floor(Math.random() * 1000)}`;
    $('cd-realname').value = prefs.realname ?? 'Comic Chat Web user';
    $('cd-email').value = prefs.email ?? '';
    $('cd-homepage').value = prefs.homepage ?? '';
    $<HTMLTextAreaElement>('cd-profile').value =
      prefs.profile ?? 'This person is too lazy to create a profile entry.';

    // character tab
    const charList = $<HTMLSelectElement>('cd-char-list');
    let selectedChar = prefs.characterId ?? 'mike';
    for (const id of characterIds) {
      const opt = document.createElement('option');
      opt.value = id;
      opt.textContent = id.toUpperCase();
      if (id === selectedChar) opt.selected = true;
      charList.appendChild(opt);
    }
    const preview = $<HTMLCanvasElement>('cd-char-preview');
    const copyright = $<HTMLDivElement>('cd-char-copyright');
    const renderPreview = async () => {
      try {
        const char = await art.character(selectedChar);
        await char.preload();
        const st = new AvatarState(char);
        const geo = await computeBodyGeometry(st, st.neutralBody(), false);
        const ctx = preview.getContext('2d')!;
        ctx.fillStyle = 'white';
        ctx.fillRect(0, 0, preview.width, preview.height);
        if (geo) {
          const scale = Math.min(preview.width / geo.width, preview.height / geo.height) * 0.95;
          drawBody(
            ctx,
            geo,
            (preview.width - geo.width * scale) / 2,
            (preview.height - geo.height * scale) / 2,
            scale,
            false,
            true,
            false,
          );
        }
        copyright.textContent = char.meta.copyright?.replace(/\\n/g, ' — ') ?? '';
      } catch {
        /* ignore */
      }
    };
    charList.onchange = () => {
      selectedChar = charList.value;
      void renderPreview();
    };
    void renderPreview();

    // background tab
    const bgList = $<HTMLSelectElement>('cd-bg-list');
    let selectedBg = prefs.backgroundId ?? 'room';
    if (!backgroundIds.includes(selectedBg)) selectedBg = backgroundIds[0] ?? 'room';
    for (const id of backgroundIds) {
      const opt = document.createElement('option');
      opt.value = id;
      opt.textContent = id.toUpperCase();
      if (id === selectedBg) opt.selected = true;
      bgList.appendChild(opt);
    }
    const bgPreview = $<HTMLCanvasElement>('cd-bg-preview');
    const renderBgPreview = async () => {
      const img = await art.background(selectedBg);
      const ctx = bgPreview.getContext('2d')!;
      ctx.fillStyle = 'white';
      ctx.fillRect(0, 0, bgPreview.width, bgPreview.height);
      if (img) ctx.drawImage(img, 0, 0, bgPreview.width, bgPreview.height);
    };
    bgList.onchange = () => {
      selectedBg = bgList.value;
      void renderBgPreview();
    };
    void renderBgPreview();

    // buttons
    const ok = document.createElement('button');
    ok.textContent = 'OK';
    const cancel = document.createElement('button');
    cancel.textContent = 'Cancel';
    buttons.append(ok, cancel);
    ok.onclick = () => {
      const selectedAction: ConnectChoice['action'] = actList.checked
        ? 'list'
        : actOnly.checked
          ? 'connectonly'
          : 'room';
      const choice: ConnectChoice = {
        url: urlInput.value.trim() || PRESETS[0].url,
        nick: $('cd-nick').value.trim() || 'WebGuest',
        realname: $('cd-realname').value.trim() || 'Comic Chat Web user',
        email: $('cd-email').value.trim(),
        homepage: $('cd-homepage').value.trim(),
        profile: $<HTMLTextAreaElement>('cd-profile').value.trim(),
        channel: chanInput.value.trim() || '#comicchat',
        action: selectedAction,
        characterId: selectedChar,
        backgroundId: selectedBg,
      };
      savePrefs(choice);
      close();
      resolve(choice);
    };
    cancel.onclick = () => {
      close();
      resolve(null);
    };
  });
}

export function showAboutDialog() {
  const { body, buttons, close } = dialogFrame('About Microsoft Chat — Web');
  body.innerHTML = `
    <p style="margin:0 0 8px"><b>Comic Chat for the Web</b></p>
    <p style="margin:0 0 8px">A faithful port of Microsoft Comic Chat (1996–1998)<br>
    built from the original source release.</p>
    <p style="margin:0 0 8px">Original comic engine by DJ Kurlander, Microsoft Research.<br>
    Character art by Jim Woodring.</p>
    <p style="margin:0">Art © Microsoft Corporation, from the MIT-licensed<br>
    <a href="https://github.com/microsoft/comic-chat" target="_blank">microsoft/comic-chat</a> release.</p>`;
  const ok = document.createElement('button');
  ok.textContent = 'OK';
  buttons.append(ok);
  ok.onclick = close;
}

// ---------------------------------------------------------------------------
// Options dialog (mirrors IDD_SETTINGSPAGE / IDD_PERSONALPAGE_IRC /
// IDD_TEXTFONTPAGE_IRC — the "Microsoft Chat Options" property sheet)

export type LineSpacing = 'all' | 'different' | 'none';

export interface OptionsState {
  // Personal Info (shared with the connect prefs)
  realname: string;
  nick: string;
  email: string;
  homepage: string;
  profile: string;
  // Settings
  dontSendComicData: boolean;
  allowWhispers: boolean;
  playSounds: boolean;
  showArrivals: boolean;
  getIdentityOnArrival: boolean;
  appearInUserLists: boolean;
  receiveInvitations: boolean;
  receiveFileTransfers: boolean;
  receiveNetMeeting: boolean;
  promptSaveOnExit: boolean;
  soundPath: string;
  // Text View
  lineSpacing: LineSpacing;
  headersSeparate: boolean;
  hostHeadersBold: boolean;
  hostMessagesBold: boolean;
}

const OPTIONS_KEY = 'comicchat-options';

const DEFAULT_OPTIONS: Omit<OptionsState, 'realname' | 'nick' | 'email' | 'homepage' | 'profile'> =
  {
    dontSendComicData: false,
    allowWhispers: true,
    playSounds: true,
    showArrivals: true,
    getIdentityOnArrival: true,
    appearInUserLists: true,
    receiveInvitations: true,
    receiveFileTransfers: true,
    receiveNetMeeting: true,
    promptSaveOnExit: false,
    soundPath: 'C:\\windows\\media',
    lineSpacing: 'all',
    headersSeparate: true,
    hostHeadersBold: true,
    hostMessagesBold: true,
  };

export function loadOptions(): OptionsState {
  const p = loadPrefs();
  let saved: Partial<OptionsState> = {};
  try {
    saved = JSON.parse(localStorage.getItem(OPTIONS_KEY) ?? '{}');
  } catch {
    /* ignore */
  }
  return {
    ...DEFAULT_OPTIONS,
    realname: p.realname ?? 'Comic Chat Web user',
    nick: p.nick ?? 'WebGuest',
    email: p.email ?? '',
    homepage: p.homepage ?? '',
    profile: p.profile ?? 'This person is too lazy to create a profile entry.',
    ...saved,
  };
}

export function showOptionsDialog(
  initialTab: 'personal' | 'settings' | 'textview' = 'personal',
): Promise<OptionsState | null> {
  return new Promise((resolve) => {
    const cur = loadOptions();
    const { body, buttons, close } = dialogFrame('Microsoft Chat Options');
    body.classList.add('cd-body', 'opt-body');
    const chk = (id: string, label: string, checked: boolean, disabled = false) =>
      `<div class="field-row"><input type="checkbox" id="${id}"${checked ? ' checked' : ''}${
        disabled ? ' disabled' : ''
      }><label for="${id}"${disabled ? ' class="opt-disabled"' : ''}>${label}</label></div>`;

    body.innerHTML = `
      <menu role="tablist">
        <li role="tab" data-tab="personal"><a href="#">Personal Info</a></li>
        <li role="tab" data-tab="settings"><a href="#">Settings</a></li>
        <li role="tab" data-tab="textview"><a href="#">Text View</a></li>
      </menu>
      <div class="tab-panel" data-panel="personal">
        <div class="field-row-stacked"><label for="opt-realname">Real name:</label>
          <input id="opt-realname" type="text" maxlength="60"></div>
        <div class="field-row-stacked"><label for="opt-nick">Nickname:</label>
          <input id="opt-nick" type="text" maxlength="32"></div>
        <div class="field-row-stacked"><label for="opt-email">Email address:</label>
          <input id="opt-email" type="text"></div>
        <div class="field-row-stacked"><label for="opt-homepage">WWW Home Page:</label>
          <input id="opt-homepage" type="text"></div>
        <div class="field-row-stacked"><label for="opt-profile">Brief description of yourself:</label>
          <textarea id="opt-profile" rows="3"></textarea></div>
      </div>
      <div class="tab-panel" data-panel="settings" hidden>
        <fieldset>
          <legend>Connection</legend>
          <p style="margin:0 0 6px">If you are speaking mostly to people who are not using Microsoft Chat, check the box below:</p>
          ${chk('opt-dontsend', "Don't send Microsoft Chat specific information", cur.dontSendComicData)}
        </fieldset>
        <fieldset class="opt-disabled-group">
          <legend>Content Advisor</legend>
          <p style="margin:0 0 6px" class="opt-disabled">Ratings help you control what kind of Internet content the users of your computer are allowed to view.</p>
          <div class="field-row" style="justify-content:flex-end;gap:6px">
            <button disabled>Enable Ratings...</button><button disabled>Settings...</button>
          </div>
        </fieldset>
        <div class="opt-two-col">
          <div>
            ${chk('opt-whispers', 'Allow whispers', cur.allowWhispers)}
            ${chk('opt-playsounds', 'Play sounds', cur.playSounds)}
            ${chk('opt-arrivals', 'Show arrivals/departures', cur.showArrivals)}
            ${chk('opt-identity', 'Get identity on arrival', cur.getIdentityOnArrival)}
            ${chk('opt-userlists', "Appear in others' user lists", cur.appearInUserLists)}
          </div>
          <div>
            ${chk('opt-invites', 'Receive chat invitations', cur.receiveInvitations)}
            ${chk('opt-filetx', 'Receive file transfer requests', cur.receiveFileTransfers, true)}
            ${chk('opt-netmeeting', 'Receive NetMeeting calls', cur.receiveNetMeeting, true)}
            ${chk('opt-savexit', 'Prompt to save on exit', cur.promptSaveOnExit)}
          </div>
        </div>
        <div class="field-row-stacked" style="margin-top:8px"><label for="opt-soundpath">Sound search path:</label>
          <input id="opt-soundpath" type="text"></div>
      </div>
      <div class="tab-panel" data-panel="textview" hidden>
        <fieldset>
          <legend>Line spacing</legend>
          <div style="margin-bottom:4px">Place blank lines between:</div>
          <div class="field-row"><input type="radio" name="opt-spacing" id="opt-sp-all"><label for="opt-sp-all">all messages</label></div>
          <div class="field-row"><input type="radio" name="opt-spacing" id="opt-sp-diff"><label for="opt-sp-diff">different message types</label></div>
          <div class="field-row"><input type="radio" name="opt-spacing" id="opt-sp-none"><label for="opt-sp-none">no blank lines</label></div>
          ${chk('opt-hdrsep', 'Headers and messages on different lines', cur.headersSeparate)}
        </fieldset>
        <fieldset>
          <legend>Text fonts</legend>
          <p style="margin:0 0 6px">Click on the buttons below to customize the fonts for various message types, or reset the defaults.</p>
          <div class="field-row" style="justify-content:center;gap:6px">
            <button id="opt-changefont" disabled>Change Font...</button><button id="opt-resetfont" disabled>Reset Defaults</button>
          </div>
        </fieldset>
        <fieldset>
          <legend>Host messages</legend>
          <div style="margin-bottom:4px">Highlight host messages:</div>
          ${chk('opt-hosthdr', 'Make host message headers bold', cur.hostHeadersBold)}
          ${chk('opt-hostmsg', 'Make host messages bold', cur.hostMessagesBold)}
        </fieldset>
      </div>`;

    const $ = <T extends HTMLElement = HTMLInputElement>(id: string) =>
      body.querySelector<T>(`#${id}`)!;

    const tabs = [...body.querySelectorAll<HTMLLIElement>('menu[role=tablist] li')];
    const panels = [...body.querySelectorAll<HTMLElement>('.tab-panel')];
    const selectTab = (name: string) => {
      for (const t of tabs) t.setAttribute('aria-selected', String(t.dataset.tab === name));
      for (const p of panels) p.hidden = p.dataset.panel !== name;
    };
    for (const t of tabs)
      t.addEventListener('click', (e) => {
        e.preventDefault();
        selectTab(t.dataset.tab!);
      });
    selectTab(initialTab);

    // fill values
    $('opt-realname').value = cur.realname;
    $('opt-nick').value = cur.nick;
    $('opt-email').value = cur.email;
    $('opt-homepage').value = cur.homepage;
    $<HTMLTextAreaElement>('opt-profile').value = cur.profile;
    $('opt-soundpath').value = cur.soundPath;
    $(
      cur.lineSpacing === 'different'
        ? 'opt-sp-diff'
        : cur.lineSpacing === 'none'
          ? 'opt-sp-none'
          : 'opt-sp-all',
    ).checked = true;

    const ok = document.createElement('button');
    ok.textContent = 'OK';
    const cancel = document.createElement('button');
    cancel.textContent = 'Cancel';
    buttons.append(ok, cancel);
    ok.onclick = () => {
      const lineSpacing: LineSpacing = $('opt-sp-diff').checked
        ? 'different'
        : $('opt-sp-none').checked
          ? 'none'
          : 'all';
      const next: OptionsState = {
        realname: $('opt-realname').value.trim() || 'Comic Chat Web user',
        nick: $('opt-nick').value.trim() || cur.nick,
        email: $('opt-email').value.trim(),
        homepage: $('opt-homepage').value.trim(),
        profile: $<HTMLTextAreaElement>('opt-profile').value.trim(),
        dontSendComicData: $('opt-dontsend').checked,
        allowWhispers: $('opt-whispers').checked,
        playSounds: $('opt-playsounds').checked,
        showArrivals: $('opt-arrivals').checked,
        getIdentityOnArrival: $('opt-identity').checked,
        appearInUserLists: $('opt-userlists').checked,
        receiveInvitations: $('opt-invites').checked,
        receiveFileTransfers: $('opt-filetx').checked,
        receiveNetMeeting: $('opt-netmeeting').checked,
        promptSaveOnExit: $('opt-savexit').checked,
        soundPath: $('opt-soundpath').value,
        lineSpacing,
        headersSeparate: $('opt-hdrsep').checked,
        hostHeadersBold: $('opt-hosthdr').checked,
        hostMessagesBold: $('opt-hostmsg').checked,
      };
      // Personal Info is shared with the connect dialog's prefs.
      savePrefs({
        ...loadPrefs(),
        nick: next.nick,
        realname: next.realname,
        email: next.email,
        homepage: next.homepage,
        profile: next.profile,
      });
      localStorage.setItem(OPTIONS_KEY, JSON.stringify(next));
      close();
      resolve(next);
    };
    cancel.onclick = () => {
      close();
      resolve(null);
    };
  });
}

// ---------------------------------------------------------------------------
// Automations dialog (mirrors IDD_AUTOMATION_PAGE / IDD_NOTIFICATIONS /
// IDD_RULESETSPAGE / IDD_RULESPAGE — the "Microsoft Chat Automations" sheet)

export type GreetingMode = 'none' | 'whisper' | 'say';
export interface Macro {
  key: string;
  name: string;
  text: string;
}
export interface AutomationsState {
  greetingMode: GreetingMode;
  greetingMessage: string;
  autoIgnore: boolean;
  floodCount: number;
  floodInterval: number;
  macros: Macro[];
}

const AUTOMATIONS_KEY = 'comicchat-automations';

const DEFAULT_AUTOMATIONS: AutomationsState = {
  greetingMode: 'none',
  greetingMessage: 'Howdy %name!  Welcome to room %room.  Enjoy your stay.',
  autoIgnore: false,
  floodCount: 4,
  floodInterval: 5,
  macros: [],
};

const MACRO_KEYS = [
  ...Array.from({ length: 10 }, (_, i) => `Alt+${i}`),
  ...Array.from({ length: 10 }, (_, i) => `Ctrl+${i}`),
];

export function loadAutomations(): AutomationsState {
  try {
    return { ...DEFAULT_AUTOMATIONS, ...JSON.parse(localStorage.getItem(AUTOMATIONS_KEY) ?? '{}') };
  } catch {
    return { ...DEFAULT_AUTOMATIONS };
  }
}

export function showAutomationsDialog(
  initialTab: 'general' | 'notify' | 'rulesets' | 'rules' = 'general',
): Promise<AutomationsState | null> {
  return new Promise((resolve) => {
    const cur = loadAutomations();
    const macros = cur.macros.map((m) => ({ ...m }));
    const { body, buttons, close } = dialogFrame('Microsoft Chat Automations');
    body.classList.add('cd-body', 'au-body');

    body.innerHTML = `
      <menu role="tablist">
        <li role="tab" data-tab="general"><a href="#">Automation</a></li>
        <li role="tab" data-tab="notify"><a href="#">User login notifications</a></li>
        <li role="tab" data-tab="rulesets"><a href="#">Rule Sets</a></li>
        <li role="tab" data-tab="rules"><a href="#">Rules</a></li>
      </menu>
      <div class="tab-panel" data-panel="general">
        <fieldset>
          <legend>Automatic greeting</legend>
          <p style="margin:0 0 6px">You may choose to send a message to any user that enters the room after you, if you are a host in the current room.</p>
          <div class="field-row" style="justify-content:center;gap:18px;margin-bottom:6px">
            <span class="field-row"><input type="radio" name="au-greet" id="au-greet-none"><label for="au-greet-none">None</label></span>
            <span class="field-row"><input type="radio" name="au-greet" id="au-greet-whisper"><label for="au-greet-whisper">Whispered</label></span>
            <span class="field-row"><input type="radio" name="au-greet" id="au-greet-say"><label for="au-greet-say">Said</label></span>
          </div>
          <textarea id="au-greet-msg" rows="2" style="width:100%;box-sizing:border-box"></textarea>
        </fieldset>
        <fieldset>
          <legend>Auto ignore flooders</legend>
          <div class="au-flood">
            <div class="field-row"><input type="checkbox" id="au-autoignore"><label for="au-autoignore">Auto ignore enabled</label></div>
            <div>
              <div class="field-row" style="justify-content:flex-end;gap:6px;margin-bottom:4px"><label for="au-count">Message Count:</label><input type="number" id="au-count" min="1" class="au-num"></div>
              <div class="field-row" style="justify-content:flex-end;gap:6px"><label for="au-interval">Interval</label><input type="number" id="au-interval" min="1" class="au-num"></div>
            </div>
          </div>
        </fieldset>
        <fieldset>
          <legend>Macros</legend>
          <p style="margin:0 0 6px">You may choose to send a message whenever you press a key combination.</p>
          <div class="field-row" style="gap:6px;margin-bottom:6px">
            <label for="au-key">Key combination:</label>
            <select id="au-key">${MACRO_KEYS.map((k) => `<option value="${k}">${k}</option>`).join('')}</select>
            <label for="au-macroname" style="margin-left:10px">Name:</label>
            <input type="text" id="au-macroname" style="flex:1">
          </div>
          <div class="au-macro-bottom">
            <textarea id="au-macrotext" rows="2"></textarea>
            <div class="au-macro-btns">
              <button id="au-addmacro" type="button">Add Macro</button>
              <button id="au-delmacro" type="button">Delete Macro</button>
            </div>
          </div>
        </fieldset>
      </div>
      <div class="tab-panel" data-panel="notify" hidden>
        <label for="au-notiflist">Current Notifications:</label>
        <select id="au-notiflist" size="6" style="width:100%;margin-bottom:8px"></select>
        <div class="au-notif-grid">
          <label>Nickname:</label><select disabled><option>is</option></select><input type="text" disabled>
          <label>User Name:</label><select disabled><option>is</option></select><input type="text" disabled>
          <label>Host Name:</label><select disabled><option>is</option></select><input type="text" disabled>
          <label>Server:</label><select disabled><option>is</option></select><input type="text" disabled>
        </div>
        <div class="field-row" style="justify-content:flex-end;gap:6px;margin-top:8px">
          <button type="button" disabled>Add</button><button type="button" disabled>Delete</button>
        </div>
      </div>
      <div class="tab-panel" data-panel="rulesets" hidden>
        <div class="au-rs-layout">
          <div>
            <label>Current Rule Sets:</label>
            <select size="8" style="width:100%"></select>
          </div>
          <div class="au-rs-btns">
            <button type="button" disabled>Rename Set...</button>
            <button type="button" disabled>Delete Set</button>
            <button type="button" disabled>Move Up</button>
            <button type="button" disabled>Move Down</button>
          </div>
        </div>
        <div class="field-row" style="gap:6px;margin-top:8px">
          <label for="au-rsname" style="flex:1">Rule set name:</label>
          <button type="button" disabled>Add Set</button>
        </div>
        <input id="au-rsname" type="text" style="width:100%;box-sizing:border-box;margin-bottom:10px">
        <div class="au-rs-actions">
          <span>Send a rule set to a user:</span><button type="button" disabled>Send Set</button>
          <span>Save a rule set into a file:</span><button type="button" disabled>Save Set..</button>
          <span>Restore a rule set from a file:</span><button type="button" disabled>Load Set...</button>
        </div>
      </div>
      <div class="tab-panel" data-panel="rules" hidden>
        <div class="au-rs-layout">
          <div>
            <label>Current Rule Sets:</label>
            <select size="4" style="width:100%"></select>
          </div>
          <div class="au-rs-btns"><button type="button" disabled>Advanced...</button></div>
        </div>
        <fieldset style="margin-top:8px">
          <legend>Rules of selected Set</legend>
          <div class="sunken-panel" style="height:150px;background:white;overflow:auto">
            <table class="interactive" style="width:100%;font-size:11px">
              <thead><tr><th style="text-align:left">Events</th><th style="text-align:left">Actions</th></tr></thead>
              <tbody></tbody>
            </table>
          </div>
          <div class="au-rules-btns">
            <button type="button" disabled>Add Rule...</button>
            <button type="button" disabled>Edit Rule...</button>
            <button type="button" disabled>Delete Rule</button>
            <button type="button" disabled>Send To User..</button>
            <button type="button" disabled>Move Up</button>
            <button type="button" disabled>Move Down</button>
            <button type="button" disabled>Add To Sets..</button>
          </div>
        </fieldset>
      </div>`;

    const $ = <T extends HTMLElement = HTMLInputElement>(id: string) =>
      body.querySelector<T>(`#${id}`)!;

    const tabs = [...body.querySelectorAll<HTMLLIElement>('menu[role=tablist] li')];
    const panels = [...body.querySelectorAll<HTMLElement>('.tab-panel')];
    const selectTab = (name: string) => {
      for (const t of tabs) t.setAttribute('aria-selected', String(t.dataset.tab === name));
      for (const p of panels) p.hidden = p.dataset.panel !== name;
    };
    for (const t of tabs)
      t.addEventListener('click', (e) => {
        e.preventDefault();
        selectTab(t.dataset.tab!);
      });
    selectTab(initialTab);

    // greeting
    $(
      cur.greetingMode === 'whisper'
        ? 'au-greet-whisper'
        : cur.greetingMode === 'say'
          ? 'au-greet-say'
          : 'au-greet-none',
    ).checked = true;
    $<HTMLTextAreaElement>('au-greet-msg').value = cur.greetingMessage;
    // flood
    $('au-autoignore').checked = cur.autoIgnore;
    $('au-count').value = String(cur.floodCount);
    $('au-interval').value = String(cur.floodInterval);
    // macros
    const keySel = $<HTMLSelectElement>('au-key');
    const nameInput = $('au-macroname');
    const textInput = $<HTMLTextAreaElement>('au-macrotext');
    const loadMacro = () => {
      const m = macros.find((x) => x.key === keySel.value);
      nameInput.value = m?.name ?? '';
      textInput.value = m?.text ?? '';
    };
    keySel.onchange = loadMacro;
    loadMacro();
    $('au-addmacro').onclick = () => {
      const text = textInput.value.trim();
      if (!text) return;
      const existing = macros.find((x) => x.key === keySel.value);
      if (existing) {
        existing.name = nameInput.value.trim();
        existing.text = text;
      } else {
        macros.push({ key: keySel.value, name: nameInput.value.trim(), text });
      }
    };
    $('au-delmacro').onclick = () => {
      const i = macros.findIndex((x) => x.key === keySel.value);
      if (i >= 0) macros.splice(i, 1);
      loadMacro();
    };

    const ok = document.createElement('button');
    ok.textContent = 'OK';
    const cancel = document.createElement('button');
    cancel.textContent = 'Cancel';
    buttons.append(ok, cancel);
    ok.onclick = () => {
      // fold an in-progress macro edit into the list
      if (textInput.value.trim()) $('au-addmacro').click();
      const next: AutomationsState = {
        greetingMode: $('au-greet-whisper').checked
          ? 'whisper'
          : $('au-greet-say').checked
            ? 'say'
            : 'none',
        greetingMessage: $<HTMLTextAreaElement>('au-greet-msg').value,
        autoIgnore: $('au-autoignore').checked,
        floodCount: Math.max(
          1,
          parseInt($('au-count').value, 10) || DEFAULT_AUTOMATIONS.floodCount,
        ),
        floodInterval: Math.max(
          1,
          parseInt($('au-interval').value, 10) || DEFAULT_AUTOMATIONS.floodInterval,
        ),
        macros,
      };
      localStorage.setItem(AUTOMATIONS_KEY, JSON.stringify(next));
      close();
      resolve(next);
    };
    cancel.onclick = () => {
      close();
      resolve(null);
    };
  });
}

// ---------------------------------------------------------------------------
// Play Sound dialog (mirrors IDD_SOUND_DLG)

export function showPlaySoundDialog(
  sounds: string[],
  onTest: (sound: string) => void,
): Promise<{ sound: string; message: string } | null> {
  return new Promise((resolve) => {
    const { body, buttons, close } = dialogFrame('Play Sound');
    body.innerHTML = `
      <div class="field-row-stacked" style="width:320px">
        <label for="ps-list">Sound file to play:</label>
        <select id="ps-list" size="10" style="width:100%"></select>
      </div>
      <div class="field-row-stacked" style="width:320px;margin-bottom:0">
        <label for="ps-msg">Accompanying message:</label>
        <input id="ps-msg" type="text" style="width:100%;box-sizing:border-box">
      </div>`;
    const list = body.querySelector<HTMLSelectElement>('#ps-list')!;
    for (const s of sounds) list.appendChild(new Option(s, s));
    const msg = body.querySelector<HTMLInputElement>('#ps-msg')!;

    const ok = document.createElement('button');
    ok.textContent = 'OK';
    ok.disabled = true;
    const test = document.createElement('button');
    test.textContent = 'Test';
    test.disabled = true;
    const cancel = document.createElement('button');
    cancel.textContent = 'Cancel';
    buttons.append(ok, test, cancel);

    list.onchange = () => {
      ok.disabled = !list.value;
      test.disabled = !list.value;
    };
    const accept = () => {
      if (!list.value) return;
      close();
      resolve({ sound: list.value, message: msg.value.trim() });
    };
    list.ondblclick = accept;
    ok.onclick = accept;
    test.onclick = () => {
      if (list.value) onTest(list.value);
    };
    cancel.onclick = () => {
      close();
      resolve(null);
    };
  });
}

// ---------------------------------------------------------------------------
// Small generic dialogs

export function promptDialog(title: string, label: string, initial = ''): Promise<string | null> {
  return new Promise((resolve) => {
    const { body, buttons, close } = dialogFrame(title);
    body.innerHTML = `<div class="field-row-stacked" style="min-width:280px">
      <label for="pd-input">${label}</label>
      <input id="pd-input" type="text"></div>`;
    const input = body.querySelector<HTMLInputElement>('#pd-input')!;
    input.value = initial;
    const ok = document.createElement('button');
    ok.textContent = 'OK';
    const cancel = document.createElement('button');
    cancel.textContent = 'Cancel';
    buttons.append(ok, cancel);
    const done = (v: string | null) => {
      close();
      resolve(v);
    };
    ok.onclick = () => done(input.value.trim() || null);
    cancel.onclick = () => done(null);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') done(input.value.trim() || null);
      if (e.key === 'Escape') done(null);
    });
    setTimeout(() => input.focus(), 0);
  });
}

export function messageDialog(title: string, text: string) {
  const { body, buttons, close } = dialogFrame(title);
  const pre = document.createElement('div');
  pre.style.cssText =
    'max-width:420px;max-height:300px;overflow:auto;white-space:pre-wrap;font-size:11px;';
  pre.textContent = text;
  body.appendChild(pre);
  const ok = document.createElement('button');
  ok.textContent = 'OK';
  buttons.append(ok);
  ok.onclick = close;
}

export interface RoomListRow {
  name: string;
  users: number;
  topic: string;
}

export function showRoomListDialog(rooms: RoomListRow[]): Promise<string | null> {
  return new Promise((resolve) => {
    const { body, buttons, close } = dialogFrame('Chat Room List');
    body.innerHTML = `
      <div class="sunken-panel" style="width:460px;height:240px;overflow:auto;background:white">
        <table class="interactive" id="rl-table" style="width:100%;border-collapse:collapse;font-size:11px">
          <thead><tr><th style="text-align:left">Room</th><th style="text-align:right">Members</th><th style="text-align:left">Topic</th></tr></thead>
          <tbody></tbody>
        </table>
      </div>
      <div style="margin-top:6px;font-size:11px">${rooms.length} room${rooms.length === 1 ? '' : 's'}</div>`;
    const tbody = body.querySelector('tbody')!;
    let selected: string | null = null;
    for (const r of rooms.slice().sort((a, b) => b.users - a.users)) {
      const tr = document.createElement('tr');
      const tdName = document.createElement('td');
      tdName.textContent = r.name;
      const tdUsers = document.createElement('td');
      tdUsers.textContent = String(r.users);
      tdUsers.style.textAlign = 'right';
      const tdTopic = document.createElement('td');
      tdTopic.textContent = r.topic;
      tr.append(tdName, tdUsers, tdTopic);
      tr.onclick = () => {
        tbody.querySelectorAll('tr').forEach((x) => x.classList.remove('highlighted'));
        tr.classList.add('highlighted');
        selected = r.name;
      };
      tr.ondblclick = () => {
        close();
        resolve(r.name);
      };
      tbody.appendChild(tr);
    }
    const go = document.createElement('button');
    go.textContent = 'Go To';
    const cancel = document.createElement('button');
    cancel.textContent = 'Cancel';
    buttons.append(go, cancel);
    go.onclick = () => {
      close();
      resolve(selected);
    };
    cancel.onclick = () => {
      close();
      resolve(null);
    };
  });
}

export function showUserListDialog(nicks: string[], title = 'User List'): Promise<string | null> {
  return new Promise((resolve) => {
    const { body, buttons, close } = dialogFrame(title);
    body.innerHTML = `<select id="ul-list" size="14" style="width:280px"></select>`;
    const list = body.querySelector<HTMLSelectElement>('#ul-list')!;
    for (const n of nicks.slice().sort((a, b) => a.localeCompare(b))) {
      const opt = document.createElement('option');
      opt.value = n;
      opt.textContent = n;
      list.appendChild(opt);
    }
    const ok = document.createElement('button');
    ok.textContent = 'OK';
    const cancel = document.createElement('button');
    cancel.textContent = 'Cancel';
    buttons.append(ok, cancel);
    ok.onclick = () => {
      close();
      resolve(list.value || null);
    };
    cancel.onclick = () => {
      close();
      resolve(null);
    };
    list.ondblclick = () => {
      close();
      resolve(list.value || null);
    };
  });
}

export function showRoomPropertiesDialog(
  channel: string,
  topic: string,
  memberCount: number,
  canEdit: boolean,
): Promise<string | null> {
  return new Promise((resolve) => {
    const { body, buttons, close } = dialogFrame('Room Properties');
    body.innerHTML = `
      <div style="min-width:340px">
        <div class="field-row"><label style="width:70px">Room:</label><b>${channel}</b></div>
        <div class="field-row"><label style="width:70px">Members:</label>${memberCount}</div>
        <div class="field-row-stacked" style="margin-top:8px">
          <label for="rp-topic">Topic</label>
          <input id="rp-topic" type="text" ${canEdit ? '' : 'readonly'}>
        </div>
      </div>`;
    const topicInput = body.querySelector<HTMLInputElement>('#rp-topic')!;
    topicInput.value = topic;
    const ok = document.createElement('button');
    ok.textContent = 'OK';
    const cancel = document.createElement('button');
    cancel.textContent = 'Cancel';
    buttons.append(ok, cancel);
    ok.onclick = () => {
      const v = topicInput.value.trim();
      close();
      resolve(canEdit && v !== topic ? v : null);
    };
    cancel.onclick = () => {
      close();
      resolve(null);
    };
  });
}

export interface FavoriteRoom {
  url: string;
  channel: string;
  label?: string; // friendly server name for display (e.g. "Libera.Chat")
}

/** How a favorite reads in a list: "#room on Libera.Chat" / "#room on ws://…". */
export function favoriteLabel(f: FavoriteRoom): string {
  return `${f.channel} on ${f.label ?? f.url}`;
}

export function showFavoritesDialog(
  favorites: FavoriteRoom[],
): Promise<{ action: 'go' | 'delete'; index: number } | null> {
  return new Promise((resolve) => {
    const { body, buttons, close } = dialogFrame('Favorites');
    body.innerHTML = `<select id="fav-list" size="10" style="width:360px"></select>`;
    const list = body.querySelector<HTMLSelectElement>('#fav-list')!;
    favorites.forEach((f, i) => {
      const opt = document.createElement('option');
      opt.value = String(i);
      opt.textContent = favoriteLabel(f);
      list.appendChild(opt);
    });
    const go = document.createElement('button');
    go.textContent = 'Go To';
    const del = document.createElement('button');
    del.textContent = 'Delete';
    const cancel = document.createElement('button');
    cancel.textContent = 'Cancel';
    buttons.append(go, del, cancel);
    go.onclick = () => {
      if (list.value) {
        close();
        resolve({ action: 'go', index: +list.value });
      }
    };
    del.onclick = () => {
      if (list.value) {
        close();
        resolve({ action: 'delete', index: +list.value });
      }
    };
    cancel.onclick = () => {
      close();
      resolve(null);
    };
    list.ondblclick = () => {
      if (list.value) {
        close();
        resolve({ action: 'go', index: +list.value });
      }
    };
  });
}

export function showWhisperBoxDialog(
  nicks: string[],
  preselected: string[],
  onWhisper: (targets: string[], text: string) => void,
) {
  const { body, buttons, close } = dialogFrame('Whisper Box');
  body.innerHTML = `
    <div style="display:flex;gap:10px;min-width:460px">
      <div class="field-row-stacked" style="flex:0 0 170px;min-width:0;margin-bottom:0">
        <label>Members</label>
        <select id="wb-list" multiple style="width:100%;height:144px;overflow-y:auto"></select>
      </div>
      <div class="field-row-stacked" style="flex:1;min-width:0;margin-bottom:0">
        <label for="wb-text">Whisper text</label>
        <textarea id="wb-text" rows="7" style="width:100%;box-sizing:border-box;resize:none"></textarea>
      </div>
    </div>`;
  const list = body.querySelector<HTMLSelectElement>('#wb-list')!;
  for (const n of nicks) {
    const opt = document.createElement('option');
    opt.value = n;
    opt.textContent = n;
    if (preselected.includes(n.toLowerCase())) opt.selected = true;
    list.appendChild(opt);
  }
  const text = body.querySelector<HTMLTextAreaElement>('#wb-text')!;
  const whisper = document.createElement('button');
  whisper.textContent = 'Whisper';
  const closeBtn = document.createElement('button');
  closeBtn.textContent = 'Close';
  buttons.append(whisper, closeBtn);
  whisper.onclick = () => {
    const targets = [...list.selectedOptions].map((o) => o.value);
    const t = text.value.trim();
    if (targets.length && t) {
      onWhisper(targets, t);
      text.value = '';
    }
  };
  closeBtn.onclick = close;
}

export function showColorDialog(current: number | null): Promise<number | null> {
  return new Promise((resolve) => {
    const { body, buttons, close } = dialogFrame('Color');
    const grid = document.createElement('div');
    grid.style.cssText =
      'display:grid;grid-template-columns:repeat(8,32px);gap:4px;padding:4px;background:silver';
    const COLORS = [
      'rgb(0,0,0)',
      'rgb(128,0,0)',
      'rgb(0,128,0)',
      'rgb(128,128,0)',
      'rgb(0,0,128)',
      'rgb(128,0,128)',
      'rgb(0,128,128)',
      'rgb(128,128,128)',
      'rgb(192,192,192)',
      'rgb(255,0,0)',
      'rgb(0,255,0)',
      'rgb(255,255,0)',
      'rgb(0,0,255)',
      'rgb(255,0,255)',
      'rgb(0,255,255)',
      'rgb(255,255,255)',
    ];
    let selected: number | null = current;
    const cells: HTMLElement[] = [];
    COLORS.forEach((c, i) => {
      const cell = document.createElement('div');
      cell.style.cssText = `width:32px;height:20px;background:${c};box-shadow:inset -1px -1px #fff, inset 1px 1px grey;cursor:pointer`;
      const mark = () => {
        cells.forEach((x) => {
          x.style.outline = '';
        });
        cell.style.outline = '2px solid navy';
        selected = i;
      };
      if (i === current) setTimeout(mark, 0);
      cell.onclick = mark;
      cell.ondblclick = () => {
        selected = i;
        close();
        resolve(i);
      };
      cells.push(cell);
      grid.appendChild(cell);
    });
    body.appendChild(grid);
    const ok = document.createElement('button');
    ok.textContent = 'OK';
    const def = document.createElement('button');
    def.textContent = 'Default';
    const cancel = document.createElement('button');
    cancel.textContent = 'Cancel';
    buttons.append(ok, def, cancel);
    ok.onclick = () => {
      close();
      resolve(selected);
    };
    def.onclick = () => {
      close();
      resolve(-1);
    }; // -1 = reset to default
    cancel.onclick = () => {
      close();
      resolve(null);
    };
  });
}
