// MSVC rand(): the original seeds each panel (srand(m_seed)) so a panel
// always lays out the same way on redraw. We reproduce the exact LCG.

export class MsvcRand {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  /** rand(): 0..32767 */
  rand(): number {
    this.state = (Math.imul(this.state, 214013) + 2531011) >>> 0;
    return (this.state >>> 16) & 0x7fff;
  }

  /** balloon.cpp randfloat(): rand()/RAND_MAX in [0,1] */
  randfloat(): number {
    return this.rand() / 32767;
  }
}

/** Global (non-panel) rand for seeds, like the original's unseeded rand(). */
export const globalRand = new MsvcRand((Math.random() * 0x7fffffff) | 0);
