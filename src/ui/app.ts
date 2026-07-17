// Application shell: window chrome, panes, wiring between UI, engine and chat.
// Menus, toolbars and context menus mirror the original chat.rc resources.

import { ArtStore } from '../art/store';
import { AvatarState, computeBodyGeometry, drawBody } from '../engine/avatar';
import { makeFontInfo } from '../engine/balloon';
import { Page } from '../engine/page';
import {
  DEFAULT_FORMAT,
  FORMAT_COLORS,
  encodeFormatted,
  hasFormatting,
  parseFormatted,
  stripFormatting,
  type CharFormat,
  type TextSegment,
} from '../engine/richtext';
import { Room, type Member } from '../engine/room';
import { getEmotionsFromString } from '../engine/semantics';
import { publicUrl } from '../public-url';
import { BALLOON_FONT_TWIPS } from '../engine/twips';
import type { Emotion } from '../art/types';
import { EM, EMOTION_FLOATS } from '../art/types';
import type { BalloonType } from '../engine/balloon';
import { DemoSession } from '../irc/demo';
import { IrcSession } from '../irc/ircsession';
import type {
  BalloonKind,
  CCMeta,
  ChatMessage,
  SessionEvent,
  SessionOptions,
} from '../irc/session';
import { ChatSession } from '../irc/session';
import { CommandRegistry } from './commands';
import {
  loadPrefs,
  messageDialog,
  promptDialog,
  showAboutDialog,
  showColorDialog,
  showConnectDialog,
  showFavoritesDialog,
  showRoomListDialog,
  showRoomPropertiesDialog,
  showUserListDialog,
  showWhisperBoxDialog,
  type FavoriteRoom,
} from './dialogs';
import { buildMenuBar, showContextMenu, type MenuDef, type MenuEntry } from './menus';
import { initSplitter } from './splitters';
import { Toolbars } from './toolbar';
import { EmotionWheel } from './wheel';

/** Characters excluded from the standard roster (color demo characters not in
 *  the authentic 2.5 character list). */
const EXCLUDED_CHARACTERS = new Set(['buck', 'kirby', 'veronica']);

/** Color backgrounds excluded from the picker — the classic look is the
 *  black & white Woodring hatched art. */
const EXCLUDED_BACKGROUNDS = new Set(['buckroom', 'clouds', 'den', 'space', 'volcano', 'yellow']);

interface TranscriptLine {
  nick: string;
  kind: BalloonKind | 'info';
  text: string;
  self: boolean;
}

export class App {
  art: ArtStore;
  myCharacterId = 'mike';
  wheel!: EmotionWheel;
  myAvatar: AvatarState | null = null;
  session: ChatSession | null = null;
  room: Room;
  page: Page;
  registry = new CommandRegistry();
  toolbars!: Toolbars;

  viewMode: 'comics' | 'text' = 'comics';
  rosterMode: 'icon' | 'list' = 'icon';
  /** Outgoing text format (the Format menu / text toolbar toggles). */
  format: CharFormat = { ...DEFAULT_FORMAT };
  comicFontFamily = '"Comic Sans MS", "Comic Neue", cursive';
  statusWindowVisible = false;
  statusBarVisible = true;
  soundsOff = false;
  away = false;
  transcript: TranscriptLine[] = [];
  private lastJoinedChannel = '';
  topic = '';
  motd = '';
  ignored = new Set<string>();
  selectedMembers = new Set<string>();
  contextMember: string | null = null; // member targeted by context menu
  private renderQueued = false;

  private $ = (id: string) => document.getElementById(id)!;

  constructor(art: ArtStore) {
    this.art = art;
    this.room = new Room(art);
    this.room.eligibleCharacterIds = this.rosterCharacterIds();
    this.page = new Page(art);
    this.room.onRosterChange = () => this.renderRoster();
    this.page.onLayout = () => this.queueRender();
  }

  rosterCharacterIds(): string[] {
    return this.art.characterIds().filter((id) => !EXCLUDED_CHARACTERS.has(id));
  }

  rosterBackgroundIds(): string[] {
    return this.art.index.backgrounds
      .map((b) => b.id)
      .filter((id) => !EXCLUDED_BACKGROUNDS.has(id));
  }

  async init() {
    this.registerCommands();
    this.registry.onAfterRun = () => this.refreshChrome();
    this.buildMenus();
    this.toolbars = new Toolbars(this.$('toolbar'), this.registry);
    this.toolbars.render();
    this.buildInputButtons();
    this.initSplitters();
    this.initContextMenus();
    this.initAccelerators();
    this.wheel = new EmotionWheel(this.$('wheel-canvas') as HTMLCanvasElement);
    this.wheel.onChange = (em) => {
      void this.renderSelfView(em);
    };
    this.$('self-pane').addEventListener('dblclick', () => void this.connectFlow('character'));
    this.myCharacterId = loadPrefs().characterId ?? this.myCharacterId;
    await this.setMyCharacter(this.myCharacterId);
    this.renderRoster();
    this.setStatus('Not connected');
    this.hookInput();
    window.addEventListener('resize', () => {
      this.updatePanelSize();
      this.queueRender();
    });
    this.updatePanelSize();
    void this.connectFlow();
  }

  private updatePanelSize() {
    const scroll = this.$('comic-scroll');
    this.page.setViewWidth(scroll.clientWidth, scroll.clientHeight);
  }

  // -- commands ---------------------------------------------------------

  private registerCommands() {
    const r = this.registry;
    const inRoom = () => !!this.session && !!this.room.channel;
    const connected = () => !!this.session;
    const isIrc = () => this.session instanceof IrcSession;
    const target = () => this.targetMember();

    r.registerAll([
      // File
      {
        id: 'ID_SESSION_CONNECT',
        prompt: 'Connects to a chat server.',
        tip: 'Connect',
        run: () => void this.connectFlow(),
      },
      {
        id: 'ID_SESSION_DISCONNECT',
        prompt: 'Disconnects from the current chat server.',
        tip: 'Disconnect',
        run: () => this.disconnect(),
        enabled: connected,
      },
      {
        id: 'ID_FILE_SAVE',
        prompt: 'Saves the current chat conversation.',
        tip: 'Save',
        run: () => this.saveConversation(),
        enabled: () => this.page.panels.length > 0,
      },
      {
        id: 'ID_FILE_SAVE_AS',
        prompt: 'Saves the current chat conversation.',
        tip: 'Save As',
        run: () => this.saveConversation(),
        enabled: () => this.page.panels.length > 0,
      },
      {
        id: 'ID_FILE_PRINT',
        prompt: 'Prints the chat transcript.',
        tip: 'Print',
        run: () => window.print(),
      },
      {
        id: 'ID_APP_EXIT',
        prompt: 'Quits Microsoft Chat.',
        tip: 'Exit',
        run: () => {
          this.disconnect();
          this.setStatus('Goodbye! (close the tab to exit)');
        },
      },

      // Edit
      {
        id: 'ID_EDIT_COPY',
        prompt: 'Copies the selection to the Clipboard.',
        tip: 'Copy',
        run: () => void this.copyConversation(),
        enabled: () => this.page.panels.length > 0,
      },
      {
        id: 'ID_CLEAR_HISTORY',
        prompt: 'Clears history of current window.',
        tip: 'Clear history',
        run: () => this.clearHistory(),
      },

      // View
      {
        id: 'ID_VIEW_TOOLBAR_MAIN',
        run: () => this.toolbars.toggle('main'),
        checked: () => this.toolbars.visible.main,
      },
      {
        id: 'ID_VIEW_TOOLBAR_MEMBER',
        run: () => this.toolbars.toggle('member'),
        checked: () => this.toolbars.visible.member,
      },
      {
        id: 'ID_VIEW_TOOLBAR_TEXT',
        run: () => this.toolbars.toggle('text'),
        checked: () => this.toolbars.visible.text,
      },
      {
        id: 'ID_VIEW_STATUS_BAR',
        run: () => this.toggleStatusBar(),
        checked: () => this.statusBarVisible,
      },
      {
        id: 'ID_VIEW_STATUSWINDOW',
        run: () => this.toggleStatusWindow(),
        checked: () => this.statusWindowVisible,
      },
      {
        id: 'ID_VIEW_COMICS',
        prompt: 'Displays this chat session in Comic Strip view.',
        tip: 'Comics View',
        run: () => this.setViewMode('comics'),
        checked: () => this.viewMode === 'comics',
      },
      {
        id: 'ID_VIEW_TEXT',
        prompt: 'Displays this chat session in Plain Text view.',
        tip: 'Text View',
        run: () => this.setViewMode('text'),
        checked: () => this.viewMode === 'text',
      },
      {
        id: 'ID_VIEW_LIST',
        run: () => this.setRosterMode('list'),
        checked: () => this.rosterMode === 'list',
      },
      {
        id: 'ID_VIEW_ICON',
        run: () => this.setRosterMode('icon'),
        checked: () => this.rosterMode === 'icon',
      },
      { id: 'ID_MOTD', run: () => this.showMotd(), enabled: connected },
      {
        id: 'ID_TURN_OFF_SOUNDS',
        run: () => {
          this.soundsOff = !this.soundsOff;
        },
        checked: () => this.soundsOff,
      },
      {
        id: 'ID_VIEW_OPTIONS',
        prompt: 'Changes the options for Microsoft Chat.',
        tip: 'Options',
        run: () => void this.connectFlow('character'),
      },

      // Room
      {
        id: 'ID_SESSION_NEWROOM',
        prompt: 'Enters a new chat room.',
        tip: 'Enter Room',
        run: () => void this.enterRoom(),
        enabled: connected,
      },
      {
        id: 'ID_SESSION_LEAVE',
        prompt: 'Leaves the chat room, and continues to stay online.',
        tip: 'Leave Room',
        run: () => this.leaveRoom(),
        enabled: inRoom,
      },
      {
        id: 'ID_ROOM_CREATEROOM',
        prompt: 'Creates a new room.',
        tip: 'Create Room',
        run: () => void this.enterRoom('Create Room'),
        enabled: connected,
      },
      {
        id: 'ID_CHATROOM_LIST',
        prompt: 'Retrieves a list of chat rooms.',
        tip: 'Chat Room List',
        run: () => this.session?.requestRoomList(),
        enabled: connected,
      },
      {
        id: 'ID_CHANNELPROPS',
        prompt: 'Adjusts room properties.',
        tip: 'Room properties',
        run: () => void this.roomProperties(),
        enabled: inRoom,
      },

      // Member
      {
        id: 'ID_USER_LIST',
        prompt: 'Displays a list of users on your current server.',
        tip: 'User List',
        run: () => void this.userList(),
        enabled: connected,
      },
      {
        id: 'ID_INVITE',
        prompt: 'Invites a user to this chat room.',
        tip: 'Invite',
        run: () => void this.inviteUser(),
        enabled: inRoom,
      },
      {
        id: 'ID_AWAY_TOGGLE',
        prompt: 'Toggle Away From Keyboard status.',
        tip: 'Away From Keyboard',
        run: () => void this.toggleAway(),
        enabled: connected,
        checked: () => this.away,
      },
      {
        id: 'ID_MEMBER_GETINFO',
        prompt: 'Displays profile information of selected member.',
        tip: 'Get Profile',
        run: () => this.withTarget((n) => this.session?.requestProfile(n)),
        enabled: () => !!target(),
      },
      {
        id: 'ID_GETIDENTITY',
        prompt: 'Displays login identity of selected member.',
        tip: 'Get Identity',
        run: () => this.withTarget((n) => this.session?.requestIdentity(n)),
        enabled: () => !!target(),
      },
      {
        id: 'ID_WHISPERBOX_MLIST',
        prompt: 'Opens a whisper box for private messages.',
        tip: 'Whisper Box',
        run: () => this.whisperBox(),
        enabled: inRoom,
      },
      {
        id: 'ID_MEMBER_IGNORE',
        prompt: 'Ignores messages from selected member.',
        tip: 'Ignore',
        run: () => this.toggleIgnore(),
        enabled: () => !!target(),
        checked: () => !!target() && this.ignored.has(target()!.toLowerCase()),
      },
      {
        id: 'ID_GET_VERSION',
        prompt: "Displays selected member's chat program version information.",
        tip: 'Version',
        run: () => this.withTarget((n) => this.session?.requestVersion(n)),
        enabled: () => (!!target() && isIrc()) || (!!target() && !isIrc()),
      },
      {
        id: 'ID_PING_USER',
        prompt: 'Determines lag to the selected member.',
        tip: 'Lag Time',
        run: () => this.withTarget((n) => this.session?.requestLagTime(n)),
        enabled: () => !!target(),
      },
      {
        id: 'ID_GET_LOCALTIME',
        prompt: "Displays selected member's local date and time.",
        tip: 'Local Time',
        run: () => this.withTarget((n) => this.session?.requestLocalTime(n)),
        enabled: () => !!target(),
      },

      // Favorites
      { id: 'ID_FAVORITES_ADDTOFAVORITES', run: () => this.addToFavorites(), enabled: inRoom },
      {
        id: 'ID_FAVORITES_OPENFAVORITES',
        prompt: 'Opens Favorites folder.',
        tip: 'Open Favorites',
        run: () => void this.openFavorites(),
      },

      // Format (text toolbar + Format menu)
      {
        id: 'ID_SETFONT',
        prompt: 'Changes the comic balloon font.',
        tip: 'Font',
        run: () => void this.chooseFont(),
      },
      {
        id: 'ID_SETCOLOR',
        prompt: 'Changes the text color.',
        tip: 'Color',
        run: () => void this.chooseColor(),
        checked: () => this.format.color !== null,
      },
      {
        id: 'ID_SWITCHBOLD',
        prompt: 'Makes the text bold.',
        tip: 'Bold',
        run: () => this.toggleFormat('bold'),
        checked: () => this.format.bold,
      },
      {
        id: 'ID_SWITCHITALIC',
        prompt: 'Makes the text italic.',
        tip: 'Italic',
        run: () => this.toggleFormat('italic'),
        checked: () => this.format.italic,
      },
      {
        id: 'ID_SWITCHUNDERLINED',
        prompt: 'Underlines the text.',
        tip: 'Underline',
        run: () => this.toggleFormat('underline'),
        checked: () => this.format.underline,
      },
      {
        id: 'ID_SWITCHFIXEDPITCH',
        prompt: 'Uses a fixed pitch font.',
        tip: 'Fixed Pitch Font',
        run: () => this.toggleFormat('fixed'),
        checked: () => this.format.fixed,
      },
      {
        id: 'ID_SWITCHSYMBOL',
        prompt: 'Uses the Symbol font.',
        tip: 'Symbol',
        run: () => this.toggleFormat('symbol'),
        checked: () => this.format.symbol,
      },

      // Self view context
      {
        id: 'ID_BODYCONTEXT_FREEZE',
        run: () => this.toggleFreeze(),
        checked: () => !!this.myAvatar?.frozen,
      },
      { id: 'ID_BODYCONTEXT_SENDEXPRESSION', run: () => this.sendExpression(), enabled: inRoom },

      // Help
      {
        id: 'ID_HELP_TOPICS',
        run: () => window.open('https://github.com/microsoft/comic-chat', '_blank'),
      },
      {
        id: 'ID_HELP_RELEASENOTES',
        run: () =>
          messageDialog(
            'Release Notes',
            'Comic Chat for the Web\n\nA faithful port of Microsoft Comic Chat 2.5 built from the original source release. See README.md and docs/ENGINE-NOTES.md in the repository.',
          ),
      },
      {
        id: 'ID_APP_ABOUT',
        prompt: 'Displays the program information and copyright.',
        tip: 'About',
        run: () => showAboutDialog(),
      },
      { id: 'ID_HELP_MSHOMEPAGE', run: () => window.open('https://www.microsoft.com', '_blank') },
    ]);
  }

  private refreshChrome() {
    this.toolbars.render();
  }

  /** Member targeted by context menu or roster selection. */
  private targetMember(): string | null {
    if (this.contextMember) return this.contextMember;
    const first = [...this.selectedMembers][0];
    if (!first) return null;
    return this.room.members.get(first)?.nick ?? null;
  }

  private withTarget(fn: (nick: string) => void) {
    const t = this.targetMember();
    if (t) fn(t);
    this.contextMember = null;
  }

  // -- menus ---------------------------------------------------------

  private buildMenus() {
    // Mirrors IDR_MAINFRAME from chat.rc.
    const menus: MenuDef = [
      {
        title: '&File',
        items: [
          { label: '&New Connection...\tCtrl+N', cmd: 'ID_SESSION_CONNECT' },
          { label: '&Open...\tCtrl+O', cmd: 'ID_FILE_OPEN' },
          { label: '&Close', cmd: 'ID_FILE_CLOSE' },
          { sep: true },
          { label: '&Save\tCtrl+S', cmd: 'ID_FILE_SAVE' },
          { label: 'Save &As...', cmd: 'ID_FILE_SAVE_AS' },
          { label: 'Creat&e Shortcut', cmd: 'ID_FILE_CREATESHORTCUT' },
          { sep: true },
          { label: '&Print...\tCtrl+P', cmd: 'ID_FILE_PRINT' },
          { label: 'P&rint Setup...', cmd: 'ID_FILE_PRINT_SETUP' },
          { sep: true },
          { label: 'E&xit', cmd: 'ID_APP_EXIT' },
        ],
      },
      {
        title: '&Edit',
        items: [
          { label: '&Undo\tCtrl+Z', cmd: 'ID_EDIT_UNDO' },
          { sep: true },
          { label: 'Cu&t\tCtrl+X', cmd: 'ID_EDIT_CUT' },
          { label: '&Copy\tCtrl+C', cmd: 'ID_EDIT_COPY' },
          { label: '&Paste\tCtrl+V', cmd: 'ID_EDIT_PASTE' },
          { label: 'C&lear\tDel', cmd: 'ID_EDIT_DELETE' },
          { sep: true },
          { label: 'Select &All\tCtrl+A', cmd: 'ID_EDIT_SELECTALL' },
          { label: 'Clear &History', cmd: 'ID_CLEAR_HISTORY' },
        ],
      },
      {
        title: '&View',
        items: [
          {
            label: '&Toolbar',
            sub: [
              { label: '&Main', cmd: 'ID_VIEW_TOOLBAR_MAIN' },
              { label: 'Membe&r', cmd: 'ID_VIEW_TOOLBAR_MEMBER' },
              { label: '&Text', cmd: 'ID_VIEW_TOOLBAR_TEXT' },
            ],
          },
          { label: 'Ta&b Bar', cmd: 'ID_VIEW_TABBAR' },
          { label: '&Status Bar', cmd: 'ID_VIEW_STATUS_BAR' },
          { label: 'Status &Window', cmd: 'ID_VIEW_STATUSWINDOW' },
          { sep: true },
          { label: 'Comic Stri&p', cmd: 'ID_VIEW_COMICS' },
          { label: 'Plain Te&xt', cmd: 'ID_VIEW_TEXT' },
          { sep: true },
          {
            label: '&Member List',
            sub: [
              { label: '&List', cmd: 'ID_VIEW_LIST' },
              { label: '&Icon', cmd: 'ID_VIEW_ICON' },
            ],
          },
          { sep: true },
          { label: 'Message of the &Day', cmd: 'ID_MOTD' },
          { label: 'Turn O&ff Sounds', cmd: 'ID_TURN_OFF_SOUNDS' },
          { sep: true },
          { label: '&Logon Notifications...', cmd: 'ID_VIEW_LOGINNOTIFS' },
          { label: 'M&acros', sub: [{ label: '&Define Macro...', cmd: 'ID_DEFINE_MACRO' }] },
          { label: 'A&utomation...\tCtrl+L', cmd: 'ID_VIEW_AUTOMATIONS' },
          { label: '&Options...\tCtrl+Q', cmd: 'ID_VIEW_OPTIONS' },
        ],
      },
      {
        title: 'F&ormat',
        items: [
          { label: '&Color...\tCtrl+K', cmd: 'ID_SETCOLOR' },
          { label: '&Bold\tCtrl+B', cmd: 'ID_SWITCHBOLD' },
          { label: '&Italic\tCtrl+I', cmd: 'ID_SWITCHITALIC' },
          { label: '&Underline\tCtrl+U', cmd: 'ID_SWITCHUNDERLINED' },
          { label: '&Fixed Pitch Font\tCtrl+F', cmd: 'ID_SWITCHFIXEDPITCH' },
          { label: '&Symbol\tCtrl+D', cmd: 'ID_SWITCHSYMBOL' },
        ],
      },
      {
        title: '&Room',
        items: [
          { label: '&Enter Room...', cmd: 'ID_SESSION_NEWROOM' },
          { label: '&Leave Room', cmd: 'ID_SESSION_LEAVE' },
          { label: 'Crea&te Room...', cmd: 'ID_ROOM_CREATEROOM' },
          { sep: true },
          { label: '&Room List...', cmd: 'ID_CHATROOM_LIST' },
          { label: 'Room &Properties...', cmd: 'ID_CHANNELPROPS' },
          { sep: true },
          { label: '&Connect...', cmd: 'ID_SESSION_CONNECT' },
          { label: '&Disconnect', cmd: 'ID_SESSION_DISCONNECT' },
        ],
      },
      {
        title: '&Member',
        items: [
          { label: '&User List...', cmd: 'ID_USER_LIST' },
          { label: 'I&nvite...', cmd: 'ID_INVITE' },
          { label: '&Away from Keyboard...', cmd: 'ID_AWAY_TOGGLE' },
          { sep: true },
          { label: '&Get Profile', cmd: 'ID_MEMBER_GETINFO' },
          { label: 'Get I&dentity', cmd: 'ID_GETIDENTITY' },
          { label: '&Whisper Box...', cmd: 'ID_WHISPERBOX_MLIST' },
          { label: 'Add to Notifi&cations...', cmd: 'ID_ADDTONOTIFICATIONS' },
          { label: '&Ignore', cmd: 'ID_MEMBER_IGNORE' },
          { sep: true },
          { label: 'Send &E-mail', cmd: 'ID_SEND_EMAIL' },
          { label: 'Send &File...', cmd: 'ID_SEND_FILE' },
          { label: 'Visit H&ome Page', cmd: 'ID_VISIT_HOMEPAGE' },
          { label: 'Net&Meeting', cmd: 'ID_START_NETMEETING' },
          { sep: true },
          { label: '&Version', cmd: 'ID_GET_VERSION' },
          { label: 'Lag &Time', cmd: 'ID_PING_USER' },
          { label: '&Local Time', cmd: 'ID_GET_LOCALTIME' },
        ],
      },
      {
        title: 'F&avorites',
        items: [
          { label: '&Add to Favorites', cmd: 'ID_FAVORITES_ADDTOFAVORITES' },
          { label: '&Open Favorites...', cmd: 'ID_FAVORITES_OPENFAVORITES' },
        ],
      },
      {
        title: '&Help',
        items: [
          { label: '&Help Topics', cmd: 'ID_HELP_TOPICS' },
          { sep: true },
          {
            label: 'Microsoft on the &Web',
            sub: [
              { label: '&Free Stuff', cmd: 'ID_HELP_FREESTUFF' },
              { label: '&Product News', cmd: 'ID_HELP_PRODUCTNEWS' },
              { label: 'Frequently Asked &Questions', cmd: 'ID_HELP_FAQ' },
              { label: 'Online &Support', cmd: 'ID_HELP_ONLINESUPPORT' },
              { sep: true },
              { label: '&Best of the Web', cmd: 'ID_HELP_BESTOFWEB' },
              { label: 'Search the &Web...', cmd: 'ID_HELP_SEARCHTHEWEB' },
              { sep: true },
              { label: 'Microsoft &Home Page', cmd: 'ID_HELP_MSHOMEPAGE' },
            ],
          },
          { label: 'Online &Support', cmd: 'ID_HELP_ONLINESUPPORT' },
          { label: '&Release Notes', cmd: 'ID_HELP_RELEASENOTES' },
          { sep: true },
          { label: '&About Microsoft Chat', cmd: 'ID_APP_ABOUT' },
        ],
      },
    ];
    buildMenuBar(this.$('menu-bar'), menus, this.registry);
  }

  private initAccelerators() {
    document.addEventListener('keydown', (e) => {
      if (!e.ctrlKey || e.altKey || e.metaKey) return;
      const k = e.key.toLowerCase();
      const map: Record<string, string> = {
        n: 'ID_SESSION_CONNECT',
        s: 'ID_FILE_SAVE',
        p: 'ID_FILE_PRINT',
        q: 'ID_VIEW_OPTIONS',
      };
      if (map[k] && this.registry.isEnabled(map[k])) {
        e.preventDefault();
        this.registry.run(map[k]);
      }
    });
  }

  // -- splitters ---------------------------------------------------------

  private initSplitters() {
    initSplitter({
      id: 'side',
      bar: this.$('split-main'),
      before: this.$('side-pane'),
      horizontal: true,
      invert: true, // side pane is after the bar: dragging left grows it
      min: 120,
      minAfter: 300,
      onResize: () => {
        this.updatePanelSize();
        this.queueRender();
      },
    });
    initSplitter({
      id: 'member',
      bar: this.$('split-member'),
      before: this.$('member-pane'),
      horizontal: false,
      min: 48,
      minAfter: 260,
    });
    initSplitter({
      id: 'self',
      bar: this.$('split-self'),
      before: this.$('self-pane'),
      horizontal: false,
      min: 60,
      minAfter: 130,
      onResize: () => void this.renderSelfView(this.wheel.emotion),
    });
  }

  // -- context menus -----------------------------------------------------

  private initContextMenus() {
    // Comic / text view: IDR_VIEWCONTEXT
    const viewCtx = (e: MouseEvent) => {
      e.preventDefault();
      const entries: MenuEntry[] = [
        { label: '&Copy\tCtrl+C', cmd: 'ID_EDIT_COPY' },
        { label: 'Clear &History', cmd: 'ID_CLEAR_HISTORY' },
        { sep: true },
        { label: 'Comic Stri&p', cmd: 'ID_VIEW_COMICS' },
        { label: 'Plain Te&xt', cmd: 'ID_VIEW_TEXT' },
        { sep: true },
        { label: '&Room Properties...', cmd: 'ID_CHANNELPROPS' },
      ];
      showContextMenu(entries, this.registry, e.clientX, e.clientY);
    };
    this.$('comic-scroll').addEventListener('contextmenu', viewCtx);
    this.$('text-view').addEventListener('contextmenu', viewCtx);

    // Member pane: member item → IDR_MEMBERADMIN subset; empty → IDR_MEMBERCONTEXT
    this.$('member-pane').addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const cell = (e.target as HTMLElement).closest('.member-cell') as HTMLElement | null;
      if (cell?.dataset.nick) {
        this.contextMember = cell.dataset.nick;
        const entries: MenuEntry[] = [
          { label: '&Get Profile', cmd: 'ID_MEMBER_GETINFO' },
          { label: 'Get I&dentity', cmd: 'ID_GETIDENTITY' },
          { label: '&Whisper Box...', cmd: 'ID_WHISPERBOX_MLIST' },
          { label: 'Add to Notifi&cations...', cmd: 'ID_ADDTONOTIFICATIONS' },
          { label: '&Ignore', cmd: 'ID_MEMBER_IGNORE' },
          { sep: true },
          { label: 'Send &E-mail', cmd: 'ID_SEND_EMAIL' },
          { label: 'Send &File...', cmd: 'ID_SEND_FILE' },
          { label: 'Visit H&ome Page', cmd: 'ID_VISIT_HOMEPAGE' },
          { label: 'Net&Meeting', cmd: 'ID_START_NETMEETING' },
          { sep: true },
          { label: '&Version', cmd: 'ID_GET_VERSION' },
          { label: 'Lag &Time', cmd: 'ID_PING_USER' },
          { label: '&Local Time', cmd: 'ID_GET_LOCALTIME' },
        ];
        showContextMenu(entries, this.registry, e.clientX, e.clientY);
      } else {
        const entries: MenuEntry[] = [
          { label: '&List', cmd: 'ID_VIEW_LIST' },
          { label: '&Icon', cmd: 'ID_VIEW_ICON' },
        ];
        showContextMenu(entries, this.registry, e.clientX, e.clientY);
      }
    });

    // Self view: IDR_BODYCONTEXT
    this.$('self-pane').addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const entries: MenuEntry[] = [
        { label: '&Frozen', cmd: 'ID_BODYCONTEXT_FREEZE' },
        { label: '&Send Expression', cmd: 'ID_BODYCONTEXT_SENDEXPRESSION' },
      ];
      showContextMenu(entries, this.registry, e.clientX, e.clientY);
    });
    this.$('wheel-pane').addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const entries: MenuEntry[] = [
        { label: '&Frozen', cmd: 'ID_BODYCONTEXT_FREEZE' },
        { label: '&Send Expression', cmd: 'ID_BODYCONTEXT_SENDEXPRESSION' },
      ];
      showContextMenu(entries, this.registry, e.clientX, e.clientY);
    });
  }

  // -- session ---------------------------------------------------------

  async connectFlow(initialTab: 'connect' | 'character' | 'background' = 'connect') {
    const choice = await showConnectDialog(
      this.art,
      this.rosterCharacterIds(),
      this.rosterBackgroundIds(),
      {
        nick: this.session?.opts.nick,
        characterId: this.myCharacterId,
        backgroundId: this.page.backgroundId ?? 'room',
      },
      initialTab,
    );
    if (!choice) return;

    await this.setMyCharacter(choice.characterId);
    if (this.page.backgroundId !== choice.backgroundId) {
      this.page.backgroundId = choice.backgroundId;
      this.session?.announceBackground(choice.backgroundId);
    }

    if (
      this.session &&
      this.session.opts.url === choice.url &&
      this.session.opts.nick === choice.nick &&
      this.session.opts.channel === choice.channel &&
      this.session instanceof DemoSession === (choice.mode === 'demo')
    ) {
      this.queueRender();
      return;
    }

    this.disconnect();
    const opts: SessionOptions = {
      url: choice.url,
      nick: choice.nick,
      channel: choice.channel,
      characterId: choice.characterId,
    };
    const session = choice.mode === 'demo' ? new DemoSession(opts) : new IrcSession(opts);
    this.session = session;
    session.onEvent((ev) => void this.handleSessionEvent(ev));
    session.connect();
    this.refreshChrome();
  }

  disconnect() {
    this.session?.disconnect();
    this.session = null;
    this.room.clear();
    this.page.panels = [];
    this.transcript = [];
    this.renderTextView();
    this.queueRender();
    this.refreshChrome();
  }

  private async handleSessionEvent(ev: SessionEvent) {
    switch (ev.type) {
      case 'status':
        this.setStatus(
          ev.status === 'connecting'
            ? 'Connecting...'
            : ev.status === 'registered'
              ? 'Connected'
              : ev.status === 'error'
                ? `Error: ${ev.detail ?? 'connection error'}`
                : 'Disconnected',
        );
        if (ev.status === 'registered') {
          this.addStatusLine(
            this.session instanceof DemoSession
              ? 'Connected to the demo room.'
              : `Connected to ${this.session?.opts.url}.`,
          );
        }
        if (ev.status === 'error') this.addStatusLine(`Error: ${ev.detail ?? 'connection error'}`);
        if (ev.status === 'disconnected') this.setTitle('Microsoft Chat - Not Connected');
        break;
      case 'joined': {
        const prev = this.lastJoinedChannel;
        if (prev && prev !== ev.channel) {
          this.room.clear();
          this.page.panels = [];
          this.transcript = [];
          this.renderTextView();
        }
        this.lastJoinedChannel = ev.channel;
        this.room.channel = ev.channel;
        this.setTitle(`Microsoft Chat - [${ev.channel}]`);
        this.$('status-room').textContent = ev.channel;
        this.addStatusLine(`Now chatting in room ${ev.channel}.`);
        this.queueRender();
        break;
      }
      case 'members':
        for (const nick of ev.nicks) {
          const isSelf = nick.toLowerCase() === this.session?.nick.toLowerCase();
          void this.registerMember(nick, isSelf ? this.myCharacterId : undefined);
        }
        break;
      case 'join':
        this.addStatusLine(`${ev.nick} has joined the room.`);
        void this.registerMember(ev.nick);
        break;
      case 'part':
        if (ev.nick.toLowerCase() === this.session?.nick.toLowerCase()) {
          this.room.clear();
          this.room.channel = '';
          this.$('status-room').textContent = '';
          this.setTitle('Microsoft Chat - Connected');
          this.addStatusLine('You have left the room.');
        } else {
          this.addStatusLine(`${ev.nick} has left the room.`);
          this.room.removeMember(ev.nick);
          this.page.removeMember(ev.nick.toLowerCase());
        }
        break;
      case 'nick': {
        this.addStatusLine(`${ev.oldNick} is now known as ${ev.newNick}.`);
        this.room.renameMember(ev.oldNick, ev.newNick);
        const m = this.room.member(ev.newNick);
        if (m) this.syncPageMember(m);
        break;
      }
      case 'background':
        if (this.art.backgroundUrl(ev.backgroundId)) {
          this.page.backgroundId = ev.backgroundId;
          this.addStatusLine(`${ev.from} changed the background to ${ev.backgroundId}.`);
        }
        break;
      case 'info':
        this.addStatusLine(ev.text);
        this.transcript.push({ nick: '', kind: 'info', text: ev.text, self: false });
        this.renderTextView();
        break;
      case 'identity':
        this.addStatusLine(ev.text.replace(/\n/g, ' — '));
        messageDialog('Identity', ev.text);
        break;
      case 'profile':
        this.addStatusLine(`${ev.nick}'s profile: ${ev.text}`);
        messageDialog(`${ev.nick}'s Profile`, ev.text);
        break;
      case 'topic':
        this.topic = ev.topic;
        this.addStatusLine(`Topic: ${ev.topic}`);
        break;
      case 'roomlist':
        void showRoomListDialog(ev.rooms).then((room) => {
          if (room) this.session?.joinRoom(room);
        });
        break;
      case 'motd':
        this.motd = ev.text;
        break;
      case 'message':
        await this.handleChatMessage(ev.msg);
        break;
    }
    const n = this.room.members.size;
    this.$('status-users').textContent = n ? `${n} member${n === 1 ? '' : 's'}` : '';
    this.refreshChrome();
  }

  private async registerMember(nick: string, characterId?: string) {
    const m = await this.room.ensureAvatar(nick, characterId);
    this.syncPageMember(m);
    // Keep a single avatar state for self (rotation/freeze live together).
    if (m.avatar && this.session && nick.toLowerCase() === this.session.nick.toLowerCase()) {
      m.avatar.frozen = this.myAvatar?.frozen ?? false;
      this.myAvatar = m.avatar;
    }
    return m;
  }

  private syncPageMember(m: Member) {
    if (!m.avatar) return;
    this.page.setMember({
      key: m.nick.toLowerCase(),
      nick: m.nick,
      avatar: m.avatar,
      talkTos: m.talkTos,
    });
  }

  private async handleChatMessage(msg: ChatMessage) {
    if (this.ignored.has(msg.from.toLowerCase())) return;

    const member = await this.registerMember(msg.from, msg.cc?.characterId ?? undefined);
    if (msg.cc) member.isComicUser = true;
    if (!msg.text) return;

    if (msg.kind === 'whisper' && !msg.self) {
      const me = this.session?.nick.toLowerCase() ?? '';
      const isDirect = msg.target.toLowerCase() === me;
      const addressed = (msg.cc?.talkTos ?? []).some((n) => n.toLowerCase() === me);
      if (!isDirect && !addressed) return;
    }

    if (msg.cc?.talkTos) {
      member.talkTos = msg.cc.talkTos
        .map((n) => n.toLowerCase())
        .filter((k) => this.room.members.has(k));
      this.syncPageMember(member);
    }

    // Formatting codes → styled segments; plain text drives everything else.
    const plain = hasFormatting(msg.text) ? stripFormatting(msg.text) : msg.text;

    // Local delivery crosses an async avatar lookup. By the time it resumes,
    // send() may have reset self to neutral, so always restore the wire pose.
    if (member.avatar) {
      const cc = msg.cc;
      if (cc && (cc.faceIndex !== undefined || cc.torsoIndex !== undefined)) {
        if (!member.otherMapped) {
          member.avatar.setIndices(cc.faceIndex ?? -1, cc.torsoIndex ?? -1);
        } else {
          member.avatar.setEmotions(
            { emotion: EMOTION_FLOATS[cc.emotionIndex ?? 9] ?? 0, intensity: cc.intensity ?? 0 },
            {
              emotion: EMOTION_FLOATS[cc.torsoEmotionIndex ?? 9] ?? 0,
              intensity: cc.torsoIntensity ?? 0,
            },
          );
        }
      } else if (cc?.characterId) {
        const opts = getEmotionsFromString(plain);
        member.avatar.body = member.avatar.bodyFromEmotionOpts(opts);
      }
    }

    // '<Chr>' → expression-only reaction (AddReaction), no balloon.
    if (plain === '<Chr>') {
      this.page.addReaction(msg.from.toLowerCase());
      this.queueRender();
      return;
    }

    const kind: BalloonType = msg.kind === 'action' ? 'box' : msg.kind;
    let content: string | TextSegment[] = hasFormatting(msg.text)
      ? parseFormatted(msg.text)
      : msg.text;
    if (msg.kind === 'action') {
      // PrepareComicsAction: "Nick does something" in a box.
      const prefix = `${msg.from} `;
      content =
        typeof content === 'string'
          ? prefix + content
          : [{ text: prefix, fmt: { ...DEFAULT_FORMAT } }, ...content];
    }

    this.transcript.push({ nick: msg.from, kind: msg.kind, text: plain, self: msg.self });
    this.renderTextView();

    this.page.addLine(msg.from.toLowerCase(), content, kind);
    this.queueRender();
  }

  // -- outgoing ---------------------------------------------------------

  private buildOutgoingCC(requested: boolean): CCMeta {
    const talkTos = [...this.selectedMembers]
      .map((k) => this.room.members.get(k)?.nick)
      .filter((n): n is string => !!n);
    const { faceIndex, torsoIndex } = this.myAvatar!.getIndices();
    const { face, torso } = this.myAvatar!.getEmotions();
    return {
      characterId: this.myCharacterId,
      faceIndex,
      torsoIndex,
      emotionIndex: emotionToIndex(face),
      intensity: face.intensity,
      torsoEmotionIndex: emotionToIndex(torso),
      torsoIntensity: torso.intensity,
      requested,
      talkTos: talkTos.length ? talkTos : undefined,
    };
  }

  private send(kind: BalloonKind, textOverride?: string, whisperTargets?: string[]) {
    const input = this.$('input-field') as HTMLInputElement;
    const plain = textOverride ?? input.value.trim();
    if (!plain || !this.session || !this.myAvatar) return;
    if (!textOverride) input.value = '';
    const text = encodeFormatted(plain, this.format);

    // Like the original: a wheel-requested pose was already chosen while
    // dragging (UpdateBody) — the wire simply reads the current indices.
    // Recomputing here would rotate to a different torso than previewed.
    const requested = this.wheel.pinned;
    if (!requested && !this.myAvatar.frozen) {
      // ChatPreSendText: pick from semantics; rotation advances later when
      // the body lands in a panel.
      const opts = getEmotionsFromString(plain);
      this.myAvatar.updateBody(this.myAvatar.bodyFromEmotionOpts(opts));
    }
    const me = this.room.member(this.session.nick);

    const cc = this.buildOutgoingCC(requested);
    const targets =
      whisperTargets ??
      (kind === 'whisper'
        ? [...this.selectedMembers]
            .map((k) => this.room.members.get(k)?.nick)
            .filter((n): n is string => !!n)
        : []);
    if (kind === 'whisper' && targets.length) {
      for (const nick of targets) this.session.sendMessage(kind, text, cc, nick);
    } else {
      this.session.sendMessage(kind, text, cc);
    }

    // ResetAvatar: after speaking, an unfrozen avatar returns to neutral and
    // the wheel dot returns to the center.
    if (!this.myAvatar.frozen) {
      this.wheel.resetToNeutral();
      void this.renderSelfView(this.wheel.emotion);
    } else {
      this.wheel.pinned = false;
    }

    if (me) {
      me.talkTos = [...this.selectedMembers];
      this.syncPageMember(me);
    }
  }

  /** Send Expression (bodycam.cpp:1055): a '<Chr>' say-message whose
   *  annotation carries the current pose. */
  sendExpression() {
    if (!this.session || !this.myAvatar) return;
    // The current body already reflects the wheel selection.
    this.session.sendMessage('say', '<Chr>', this.buildOutgoingCC(true));
    this.wheel.pinned = false;
  }

  // -- view modes ---------------------------------------------------------

  setViewMode(mode: 'comics' | 'text') {
    this.viewMode = mode;
    this.$('comic-scroll').hidden = mode !== 'comics';
    (this.$('text-view') as HTMLElement).hidden = mode !== 'text';
    if (mode === 'comics') {
      this.updatePanelSize();
      this.queueRender();
    } else {
      this.renderTextView();
    }
  }

  setRosterMode(mode: 'icon' | 'list') {
    this.rosterMode = mode;
    this.renderRoster();
  }

  toggleStatusBar() {
    this.statusBarVisible = !this.statusBarVisible;
    (this.$('status-bar') as HTMLElement).style.display = this.statusBarVisible ? '' : 'none';
  }

  toggleStatusWindow() {
    this.statusWindowVisible = !this.statusWindowVisible;
    (this.$('status-window') as HTMLElement).hidden = !this.statusWindowVisible;
  }

  addStatusLine(text: string) {
    const sw = this.$('status-window');
    const line = document.createElement('div');
    line.className = 'sw-line';
    line.textContent = `${new Date().toLocaleTimeString()}  ${text}`;
    sw.appendChild(line);
    while (sw.childElementCount > 500) sw.firstElementChild!.remove();
    sw.scrollTop = sw.scrollHeight;
  }

  private renderTextView() {
    if (this.viewMode !== 'text') return;
    const tv = this.$('text-view');
    tv.innerHTML = '';
    for (const line of this.transcript) {
      if (line.text === '<Chr>') continue; // like textview.cpp
      const div = document.createElement('div');
      div.className = 'tv-line';
      const nick = document.createElement('span');
      nick.className = 'tv-nick';
      switch (line.kind) {
        case 'info':
          div.className += ' tv-info';
          div.textContent = `*** ${line.text}`;
          break;
        case 'action':
          div.className += ' tv-action';
          div.textContent = `${line.nick} ${line.text}`;
          break;
        case 'whisper':
          div.className += ' tv-whisper';
          nick.textContent = `${line.nick} whispers: `;
          div.append(nick, line.text);
          break;
        case 'think':
          div.className += ' tv-think';
          nick.textContent = `${line.nick} `;
          div.append(nick, `. o O ( ${line.text} )`);
          break;
        default:
          nick.textContent = `${line.nick}: `;
          div.append(nick, line.text);
      }
      tv.appendChild(div);
    }
    tv.scrollTop = tv.scrollHeight;
  }

  // -- member/room commands ------------------------------------------------

  private async enterRoom(title = 'Enter Room') {
    const room = await promptDialog(title, 'Room name:', '#');
    if (room) this.session?.joinRoom(room.startsWith('#') ? room : `#${room}`);
  }

  private leaveRoom() {
    this.session?.leaveRoom();
  }

  private async roomProperties() {
    const newTopic = await showRoomPropertiesDialog(
      this.room.channel,
      this.topic,
      this.room.members.size,
      true,
    );
    if (newTopic !== null) this.session?.setTopic(newTopic);
  }

  private async userList() {
    const nicks = [...this.room.members.values()].map((m) => m.nick);
    const picked = await showUserListDialog(nicks);
    if (picked) {
      this.selectedMembers.clear();
      this.selectedMembers.add(picked.toLowerCase());
      this.renderRoster();
    }
  }

  private async inviteUser() {
    const nick = await promptDialog('Invite', 'Nickname to invite:');
    if (nick) this.session?.invite(nick);
  }

  private async toggleAway() {
    if (this.away) {
      this.away = false;
      this.session?.setAway(false);
    } else {
      const msg = await promptDialog('Away from Keyboard', 'Away message:', 'Away from keyboard');
      if (msg === null) return;
      this.away = true;
      this.session?.setAway(true, msg);
    }
    this.refreshChrome();
  }

  private whisperBox() {
    const nicks = [...this.room.members.values()]
      .filter((m) => m.nick.toLowerCase() !== this.session?.nick.toLowerCase())
      .map((m) => m.nick);
    showWhisperBoxDialog(nicks, [...this.selectedMembers], (targets, text) => {
      this.send('whisper', text, targets);
    });
  }

  private toggleIgnore() {
    const t = this.targetMember();
    if (!t) return;
    const k = t.toLowerCase();
    if (this.ignored.has(k)) {
      this.ignored.delete(k);
      this.addStatusLine(`No longer ignoring ${t}.`);
    } else {
      this.ignored.add(k);
      this.addStatusLine(`Ignoring ${t}.`);
    }
    this.contextMember = null;
    this.renderRoster();
  }

  private toggleFreeze() {
    if (this.myAvatar) {
      this.myAvatar.frozen = !this.myAvatar.frozen;
      const me = this.session ? this.room.member(this.session.nick) : null;
      if (me?.avatar) me.avatar.frozen = this.myAvatar.frozen;
    }
  }

  // -- text formatting --------------------------------------------------------

  toggleFormat(key: 'bold' | 'italic' | 'underline' | 'fixed' | 'symbol') {
    this.format[key] = !this.format[key];
    this.applyInputFormat();
  }

  private async chooseColor() {
    const picked = await showColorDialog(this.format.color);
    if (picked === null) return;
    this.format.color = picked === -1 ? null : picked;
    this.applyInputFormat();
    this.refreshChrome();
  }

  private async chooseFont() {
    const fonts = [
      '"Comic Sans MS", "Comic Neue", cursive',
      '"MS Sans Serif", "Pixelated MS Sans Serif", Arial, sans-serif',
      'Arial, sans-serif',
      '"Times New Roman", serif',
      '"Courier New", monospace',
    ];
    const names = ['Comic Sans MS', 'MS Sans Serif', 'Arial', 'Times New Roman', 'Courier New'];
    const picked = await showUserListDialog(names, 'Font');
    if (!picked) return;
    this.comicFontFamily = fonts[names.indexOf(picked)];
    this.page.fontNormal = makeFontInfo(BALLOON_FONT_TWIPS, false, this.comicFontFamily);
    this.page.fontWhisper = makeFontInfo(BALLOON_FONT_TWIPS, true, this.comicFontFamily);
    this.applyInputFormat();
    this.setStatus(`Comic font: ${picked}`);
  }

  /** Mirror the outgoing format on the input field, like the RichEdit did. */
  private applyInputFormat() {
    const input = this.$('input-field') as HTMLInputElement;
    input.style.fontWeight = this.format.bold ? 'bold' : '';
    input.style.fontStyle = this.format.italic ? 'italic' : '';
    input.style.textDecoration = this.format.underline ? 'underline' : '';
    input.style.color = this.format.color !== null ? FORMAT_COLORS[this.format.color] : '';
    input.style.fontFamily = this.format.fixed ? '"Courier New", monospace' : this.comicFontFamily;
  }

  private showMotd() {
    messageDialog('Message of the Day', this.motd || 'No message of the day.');
  }

  // -- favorites -------------------------------------------------------------

  private favorites(): FavoriteRoom[] {
    try {
      return JSON.parse(localStorage.getItem('comicchat-favorites') ?? '[]');
    } catch {
      return [];
    }
  }

  private addToFavorites() {
    if (!this.session) return;
    const favs = this.favorites();
    const entry: FavoriteRoom = {
      url: this.session.opts.url,
      channel: this.room.channel,
      mode: this.session instanceof DemoSession ? 'demo' : 'irc',
    };
    if (!favs.some((f) => f.url === entry.url && f.channel === entry.channel)) {
      favs.push(entry);
      localStorage.setItem('comicchat-favorites', JSON.stringify(favs));
      this.addStatusLine(`Added ${entry.channel} to Favorites.`);
    }
  }

  private async openFavorites() {
    const favs = this.favorites();
    if (!favs.length) {
      messageDialog(
        'Favorites',
        'No favorites yet. Join a room and use Favorites → Add to Favorites.',
      );
      return;
    }
    const res = await showFavoritesDialog(favs);
    if (!res) return;
    if (res.action === 'delete') {
      favs.splice(res.index, 1);
      localStorage.setItem('comicchat-favorites', JSON.stringify(favs));
      void this.openFavorites();
    } else {
      const f = favs[res.index];
      if (
        this.session &&
        this.session instanceof DemoSession === (f.mode === 'demo') &&
        this.session.opts.url === f.url
      ) {
        this.session.joinRoom(f.channel);
      } else {
        messageDialog(
          'Favorites',
          `Connect to ${f.mode === 'demo' ? 'the demo room' : f.url} first (File → New Connection).`,
        );
      }
    }
  }

  // -- save/copy ---------------------------------------------------------------

  private saveConversation() {
    const canvas = this.$('comic-canvas') as HTMLCanvasElement;
    canvas.toBlob((blob) => {
      if (!blob) return;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${(this.room.channel || 'comic').replace(/[#&]/g, '')}-strip.png`;
      a.click();
      URL.revokeObjectURL(a.href);
    });
  }

  private async copyConversation() {
    const canvas = this.$('comic-canvas') as HTMLCanvasElement;
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res));
    if (!blob) return;
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      this.setStatus('Conversation copied to the Clipboard.');
    } catch {
      this.setStatus('Copy failed (clipboard unavailable).');
    }
  }

  private clearHistory() {
    this.page.panels = [];
    this.transcript = [];
    this.renderTextView();
    this.queueRender();
  }

  // -- rendering ---------------------------------------------------------

  queueRender() {
    if (this.renderQueued) return;
    this.renderQueued = true;
    requestAnimationFrame(() => {
      this.renderQueued = false;
      void this.renderPage();
    });
  }

  async renderPage() {
    if (this.viewMode !== 'comics') return;
    try {
      const canvas = this.$('comic-canvas') as HTMLCanvasElement;
      const scroll = this.$('comic-scroll');
      const width = scroll.clientWidth;
      const height = this.page.layoutHeightPx(width);
      const atBottom = scroll.scrollTop + scroll.clientHeight >= canvas.height - 60;
      canvas.width = width;
      canvas.height = Math.max(height, scroll.clientHeight);
      const ctx = canvas.getContext('2d')!;
      await this.page.render(ctx, width);
      if (atBottom) scroll.scrollTop = canvas.height;
    } catch (e) {
      console.error('renderPage failed:', e);
      this.setStatus(`Render error: ${(e as Error)?.message ?? e}`);
    }
  }

  async setMyCharacter(id: string) {
    this.myCharacterId = id;
    const char = await this.art.character(id);
    await char.preload();
    const frozen = this.myAvatar?.frozen ?? false;
    this.myAvatar = new AvatarState(char);
    this.myAvatar.frozen = frozen;
    if (this.session) {
      this.session.opts.characterId = id;
      this.session.announceCharacter({ characterId: id });
      await this.registerMember(this.session.nick, id);
    }
    await this.renderSelfView(this.wheel?.emotion ?? { emotion: EM.NEUTRAL, intensity: 0 });
  }

  async renderSelfView(em: Emotion) {
    if (!this.myAvatar) return;
    const candidate =
      em.intensity === 0 && em.emotion === EM.NEUTRAL
        ? this.myAvatar.neutralBody()
        : this.myAvatar.bodyFromEmotion(em);
    // UpdateBody: only adopt (and advance pose rotation) on a real change.
    this.myAvatar.updateBody(candidate);
    const body = this.myAvatar.body;
    const geo = await computeBodyGeometry(this.myAvatar, body, false);
    if (!geo) return;
    const canvas = this.$('self-canvas') as HTMLCanvasElement;
    const pane = this.$('self-pane');
    canvas.width = Math.max(80, pane.clientWidth - 8);
    canvas.height = Math.max(80, pane.clientHeight - 8);
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const scale = Math.min(canvas.width / geo.width, canvas.height / geo.height) * 0.95;
    const x = (canvas.width - geo.width * scale) / 2;
    const y = (canvas.height - geo.height * scale) / 2;
    drawBody(ctx, geo, x, y, scale, false);
  }

  renderRoster() {
    const pane = this.$('member-pane');
    pane.innerHTML = '';
    pane.classList.toggle('list-mode', this.rosterMode === 'list');
    const members = [...this.room.members.values()].sort((a, b) => a.nick.localeCompare(b.nick));
    for (const m of members) {
      const key = m.nick.toLowerCase();
      const cell = document.createElement('div');
      cell.className = 'member-cell' + (this.selectedMembers.has(key) ? ' selected' : '');
      cell.dataset.nick = m.nick;
      const img = document.createElement('img');
      const url = m.characterId ? this.art.iconUrl(m.characterId) : null;
      if (url) img.src = url;
      img.alt = '';
      const span = document.createElement('div');
      span.className = 'member-name';
      span.textContent = (this.ignored.has(key) ? '(ignored) ' : '') + m.nick;
      cell.append(img, span);
      cell.title = `${m.nick}${m.characterId ? ` (${m.characterId})` : ''}`;
      cell.onclick = () => {
        const isSelf = key === this.session?.nick.toLowerCase();
        if (isSelf) return;
        if (this.selectedMembers.has(key)) this.selectedMembers.delete(key);
        else this.selectedMembers.add(key);
        this.renderRoster();
        this.refreshChrome(); // member commands ungray with a selection
      };
      pane.appendChild(cell);
    }
  }

  // -- input ---------------------------------------------------------------

  private hookInput() {
    const input = this.$('input-field') as HTMLInputElement;
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.send(e.ctrlKey ? 'think' : 'say');
      else if (e.key === 't' && e.ctrlKey) {
        e.preventDefault();
        this.send('think');
      } else if (e.key === 'w' && e.ctrlKey) {
        e.preventDefault();
        this.send('whisper');
      } else if (e.key === 'j' && e.ctrlKey) {
        e.preventDefault();
        this.send('action');
      }
      // Format accelerators, like the original RichEdit input
      else if (e.ctrlKey && !e.altKey && !e.metaKey) {
        const map: Record<string, string> = {
          b: 'ID_SWITCHBOLD',
          i: 'ID_SWITCHITALIC',
          u: 'ID_SWITCHUNDERLINED',
          f: 'ID_SWITCHFIXEDPITCH',
          d: 'ID_SWITCHSYMBOL',
          k: 'ID_SETCOLOR',
        };
        const cmd = map[e.key.toLowerCase()];
        if (cmd) {
          e.preventDefault();
          this.registry.run(cmd);
        }
      }
    });
    this.$('input-buttons').addEventListener('click', (e) => {
      const kind = (e.target as HTMLElement).closest('button')?.dataset.kind as
        BalloonKind | undefined;
      if (kind) this.send(kind);
    });
  }

  private buildInputButtons() {
    const wrap = this.$('input-buttons');
    wrap.innerHTML = '';
    const kinds: { kind: BalloonKind; title: string; icon: number }[] = [
      { kind: 'say', title: 'Say (Enter)', icon: 0 },
      { kind: 'think', title: 'Think (Ctrl+T)', icon: 1 },
      { kind: 'whisper', title: 'Whisper (Ctrl+W)', icon: 2 },
      { kind: 'action', title: 'Action (Ctrl+J)', icon: 3 },
    ];
    for (const k of kinds) {
      const b = document.createElement('button');
      b.title = k.title;
      b.dataset.kind = k.kind;
      const span = document.createElement('span');
      span.style.cssText =
        `width:17px;height:17px;display:inline-block;` +
        `background:url(${publicUrl('ui/balloons.png')}) -${k.icon * 17}px 0;` +
        'image-rendering:pixelated;pointer-events:none';
      b.appendChild(span);
      wrap.appendChild(b);
    }
  }

  // -- chrome ---------------------------------------------------------------

  setStatus(text: string) {
    this.$('status-main').textContent = text + (this.away ? ' (Away)' : '');
  }
  setTitle(text: string) {
    this.$('title-text').textContent = text;
    document.title = text;
  }
}

function emotionToIndex(em: Emotion): number {
  const i = EMOTION_FLOATS.findIndex((f, idx) => idx > 0 && f === em.emotion);
  return i > 0 ? i : 9;
}
