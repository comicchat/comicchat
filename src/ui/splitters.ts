// Splitter bars following the classic Windows resize rules: flat silver bars,
// col-resize/row-resize cursors, live drag with minimum pane sizes, sizes
// persisted across sessions.

interface SplitSpec {
  id: string;                 // persistence key
  bar: HTMLElement;
  before: HTMLElement;        // pane before the bar (left/top)
  horizontal: boolean;        // true: bar moves horizontally (col-resize)
  min: number;                // min size of `before`
  minAfter: number;           // min size remaining after
  invert?: boolean;           // drag grows `before` when moving toward start
  onResize?: () => void;
}

const LS_KEY = 'comicchat-splitters';

function loadSizes(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) ?? '{}');
  } catch {
    return {};
  }
}

function saveSize(id: string, px: number) {
  const s = loadSizes();
  s[id] = px;
  localStorage.setItem(LS_KEY, JSON.stringify(s));
}

export function initSplitter(spec: SplitSpec) {
  const saved = loadSizes()[spec.id];
  if (saved && saved >= spec.min) {
    applySize(spec, saved);
  }

  spec.bar.classList.add(spec.horizontal ? 'splitter-v' : 'splitter-h');

  spec.bar.addEventListener('mousedown', (e) => {
    e.preventDefault();
    const startPos = spec.horizontal ? e.clientX : e.clientY;
    const startSize = spec.horizontal ? spec.before.offsetWidth : spec.before.offsetHeight;
    const parent = spec.before.parentElement!;
    const total = spec.horizontal ? parent.clientWidth : parent.clientHeight;

    const move = (ev: MouseEvent) => {
      const pos = spec.horizontal ? ev.clientX : ev.clientY;
      let delta = pos - startPos;
      if (spec.invert) delta = -delta;
      let size = startSize + delta;
      size = Math.max(spec.min, Math.min(size, total - spec.minAfter));
      applySize(spec, size);
      spec.onResize?.();
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      document.body.style.cursor = '';
      saveSize(spec.id, spec.horizontal ? spec.before.offsetWidth : spec.before.offsetHeight);
      spec.onResize?.();
    };
    document.body.style.cursor = spec.horizontal ? 'col-resize' : 'row-resize';
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  });
}

function applySize(spec: SplitSpec, px: number) {
  if (spec.horizontal) {
    spec.before.style.flex = `0 0 ${px}px`;
    spec.before.style.width = `${px}px`;
  } else {
    spec.before.style.flex = `0 0 ${px}px`;
    spec.before.style.height = `${px}px`;
  }
}
