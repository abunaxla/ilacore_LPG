/**
 * Scenarios: what is in front of the reader and how badly it behaves. Seeded, so the same scenario
 * always produces the same reads (tests and demos can be repeated exactly).
 */
import type { TagRead } from './adapter.js';

export interface Scenario {
  /** Tags that should be read (the cylinders actually being scanned). */
  readonly expected: readonly string[];
  /** How many expected tags the reader misses entirely. */
  readonly missed: number;
  /** How many stray tags it picks up (cylinders nearby that aren't part of the job). */
  readonly strays: number;
  /** Optional fixed stray tag numbers; otherwise random ones are made up. */
  readonly strayEpcs?: readonly string[];
  /** Reads per tag that is seen, inclusive range (duplicates are normal for UHF readers). */
  readonly readsPerTag?: readonly [number, number];
  /** How long the scan lasts, in milliseconds. */
  readonly durationMs?: number;
  /** Number of antennas (reads are spread across them). */
  readonly antennas?: number;
  readonly seed?: number;
}

export interface ScenarioResult {
  /** Every raw read, in time order, duplicates and strays included. */
  readonly reads: TagRead[];
  /** Expected tags that were read. */
  readonly seen: string[];
  /** Expected tags that were never read. */
  readonly missed: string[];
  /** Tags read that weren't expected. */
  readonly strays: string[];
}

/** Small, fast, seedable random numbers (mulberry32). Not for anything secret. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A random 96-bit tag number (24 hex digits). */
export function randomEpc(random: () => number): string {
  let s = '';
  for (let i = 0; i < 24; i += 1) s += Math.floor(random() * 16).toString(16).toUpperCase();
  return s;
}

function pick<T>(items: T[], count: number, random: () => number): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy.slice(0, count);
}

/** Runs a scenario starting at `startAt` and returns every read the reader would report. */
export function runScenario(scenario: Scenario, startAt: Date = new Date()): ScenarioResult {
  const random = seededRandom(scenario.seed ?? 1);
  const expected = [...new Set(scenario.expected)];
  if (scenario.missed < 0 || scenario.missed > expected.length) throw new RangeError('missed must be between 0 and the expected count');
  if (scenario.strays < 0) throw new RangeError('strays must not be negative');
  const [minReads, maxReads] = scenario.readsPerTag ?? [1, 6];
  if (minReads < 1 || maxReads < minReads) throw new RangeError('readsPerTag must be [min >= 1, max >= min]');
  const duration = scenario.durationMs ?? 20_000;
  const antennas = scenario.antennas ?? 2;

  const missed = pick(expected, scenario.missed, random);
  const missedSet = new Set(missed);
  const seen = expected.filter((e) => !missedSet.has(e));
  const strays = [...(scenario.strayEpcs ?? [])].slice(0, scenario.strays);
  while (strays.length < scenario.strays) {
    const epc = randomEpc(random);
    if (!expected.includes(epc) && !strays.includes(epc)) strays.push(epc);
  }

  const reads: TagRead[] = [];
  const emit = (epc: string, baseRssi: number, count: number) => {
    for (let i = 0; i < count; i += 1) {
      reads.push({
        epc,
        // Signal wobbles a few dB between reads of the same tag.
        rssi: Math.round((baseRssi + (random() - 0.5) * 6) * 10) / 10,
        antenna: 1 + Math.floor(random() * antennas),
        readAt: new Date(startAt.getTime() + Math.floor(random() * duration)),
      });
    }
  };
  const between = (lo: number, hi: number) => lo + Math.floor(random() * (hi - lo + 1));
  // Cylinders in the load are close: -45 to -65 dBm. Strays are further away: -70 to -80 dBm, read once or twice.
  for (const epc of seen) emit(epc, -45 - random() * 20, between(minReads, maxReads));
  for (const epc of strays) emit(epc, -70 - random() * 10, between(1, 2));
  reads.sort((a, b) => a.readAt.getTime() - b.readAt.getTime());
  return { reads, seen, missed, strays };
}

/**
 * Reads a short script such as "dispatch 40 miss 2 stray 1" (purpose, then counts in any order).
 * Words: miss/missed, stray/strays, reads A-B, seed N, for Ns (duration).
 */
export function parseScript(script: string): {
  purpose: string;
  count: number;
  missed: number;
  strays: number;
  readsPerTag?: [number, number];
  seed?: number;
  durationMs?: number;
} {
  const words = script.trim().toLowerCase().split(/\s+/);
  const purpose = words.shift();
  const count = Number(words.shift());
  if (!purpose || !Number.isInteger(count) || count < 0) throw new SyntaxError('Start with a purpose and a count, e.g. "dispatch 40"');
  const out: ReturnType<typeof parseScript> = { purpose, count, missed: 0, strays: 0 };
  while (words.length > 0) {
    const word = words.shift()!;
    const value = words.shift();
    if (value === undefined) throw new SyntaxError(`"${word}" needs a value`);
    if (word === 'miss' || word === 'missed') out.missed = Number(value);
    else if (word === 'stray' || word === 'strays') out.strays = Number(value);
    else if (word === 'seed') out.seed = Number(value);
    else if (word === 'for' && /^\d+s$/.test(value)) out.durationMs = Number(value.slice(0, -1)) * 1000;
    else if (word === 'reads' && /^\d+-\d+$/.test(value)) {
      const [a, b] = value.split('-').map(Number) as [number, number];
      out.readsPerTag = [a, b];
    } else throw new SyntaxError(`Unknown word "${word}"`);
  }
  for (const n of [out.missed, out.strays]) if (!Number.isInteger(n) || n < 0) throw new SyntaxError('Counts must be whole numbers');
  if (out.missed > count) throw new SyntaxError('Cannot miss more tags than there are');
  return out;
}
