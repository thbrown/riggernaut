/**
 * Simple seeded PRNG (mulberry32) for deterministic simulation.
 * Use this instead of Math.random() in any simulation-affecting code.
 */
export class DeterministicRng {
  private state: number;

  constructor(seed: number = 42) {
    this.state = seed;
  }

  /** Returns a pseudo-random number in [0, 1) */
  next(): number {
    this.state |= 0;
    this.state = (this.state + 0x6D2B79F5) | 0;
    let t = Math.imul(this.state ^ (this.state >>> 15), 1 | this.state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Returns a pseudo-random number in [min, max) */
  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }
}
