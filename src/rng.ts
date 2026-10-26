// Seeded randomness. Every draw comes from a stream named by what it is for, so the same seed gives the
// same noise for the same thing no matter what the player did before. Replaying identical decisions with
// a different seed is therefore a clean test of luck.

export function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function mulberry32(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const stream = (seed: number, ...label: (string | number)[]): (() => number) => mulberry32(hash(`${seed}|${label.join("|")}`));

export function gauss(next: () => number): number {
  const u = Math.max(next(), 1e-12);
  const v = next();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** One standard-normal draw from the stream named by `label`. */
export const normal = (seed: number, ...label: (string | number)[]): number => gauss(stream(seed, ...label));

/** One uniform draw in [0,1) from the stream named by `label`. */
export const uniform = (seed: number, ...label: (string | number)[]): number => stream(seed, ...label)();
