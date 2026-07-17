// Art store: loads the extracted character/background assets.

import type { ArtIndex, CharacterMeta, Emotion } from './types';
import { EMOTION_FLOATS } from './types';
import { publicUrl } from '../public-url';

export interface LoadedPose {
  img: HTMLImageElement;
  aura: HTMLImageElement | null;
  w: number;
  h: number;
}

export class Character {
  meta: CharacterMeta;
  dir: string;
  private poseCache = new Map<string, Promise<LoadedPose>>();
  private poseLoaded = new Map<string, LoadedPose>();

  constructor(meta: CharacterMeta, dir: string) {
    this.meta = meta;
    this.dir = dir;
  }

  /** Synchronous pose access; null until preload() resolves. */
  poseSync(id: string | null): LoadedPose | null {
    return id ? (this.poseLoaded.get(id) ?? null) : null;
  }

  get id() {
    return this.meta.id;
  }
  get name() {
    return this.meta.name;
  }
  get isComplex() {
    return this.meta.type === 'complex';
  }

  pose(id: string | null): Promise<LoadedPose> | null {
    if (!id) return null;
    const meta = this.meta.poses[id];
    if (!meta) return null;
    let p = this.poseCache.get(id);
    if (!p) {
      p = (async () => {
        const img = await loadImage(`${this.dir}/${meta.file}`);
        const aura = meta.aura ? await loadImage(`${this.dir}/${meta.aura}`) : null;
        const loaded = { img, aura, w: meta.w, h: meta.h };
        this.poseLoaded.set(id, loaded);
        return loaded;
      })();
      this.poseCache.set(id, p);
    }
    return p;
  }

  /** Preload every pose (done when a character enters the room). */
  async preload(): Promise<void> {
    await Promise.all(Object.keys(this.meta.poses).map((id) => this.pose(id)));
  }

  emotionOf(rec: { emotionIndex: number; intensity: number }): Emotion {
    return {
      emotion: EMOTION_FLOATS[rec.emotionIndex] ?? 0,
      intensity: rec.intensity,
    };
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`failed to load ${src}`));
    img.src = src;
  });
}

export class ArtStore {
  index!: ArtIndex;
  private chars = new Map<string, Promise<Character>>();
  private base: string;

  constructor(base = publicUrl('art')) {
    this.base = base;
  }

  async init(): Promise<void> {
    const res = await fetch(`${this.base}/index.json`);
    if (!res.ok) throw new Error('art index missing — run: npm run extract-art');
    this.index = await res.json();
  }

  characterIds(): string[] {
    return this.index.characters.map((c) => c.id);
  }

  character(id: string): Promise<Character> {
    let p = this.chars.get(id);
    if (!p) {
      p = (async () => {
        const dir = `${this.base}/characters/${id}`;
        const res = await fetch(`${dir}/meta.json`);
        if (!res.ok) throw new Error(`no such character: ${id}`);
        const meta: CharacterMeta = await res.json();
        return new Character(meta, dir);
      })();
      this.chars.set(id, p);
    }
    return p;
  }

  iconUrl(id: string): string | null {
    const c = this.index.characters.find((ch) => ch.id === id);
    if (!c || !c.icon) return null;
    return `${this.base}/characters/${id}/${c.icon}.png`;
  }

  backgroundUrl(id: string): string | null {
    const b = this.index.backgrounds.find((bg) => bg.id === id);
    return b ? `${this.base}/${b.file}` : null;
  }

  async background(id: string): Promise<HTMLImageElement | null> {
    const url = this.backgroundUrl(id);
    return url ? loadImage(url) : null;
  }
}
