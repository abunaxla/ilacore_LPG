import { mergeReads } from '@ilacore/domain';
import { describe, expect, it, vi } from 'vitest';
import { ApiError, ReaderApiClient } from './api-client.js';
import { parseScript, randomEpc, runScenario, seededRandom } from './scenario.js';
import { SimulatedReader } from './simulated-reader.js';

const forty = Array.from({ length: 40 }, (_, i) => `E28011606000${String(i).padStart(12, '0')}`);
const start = new Date('2026-11-20T06:00:00Z');

describe('runScenario', () => {
  it('plays "dispatch of 40 with 2 missed and 1 stray"', () => {
    const r = runScenario({ expected: forty, missed: 2, strays: 1, seed: 7 }, start);
    expect(r.seen).toHaveLength(38);
    expect(r.missed).toHaveLength(2);
    expect(r.strays).toHaveLength(1);
    const merged = mergeReads(r.reads);
    expect(merged).toHaveLength(39);
    // Duplicates are normal: more raw reads than tags.
    expect(r.reads.length).toBeGreaterThan(merged.length);
    for (const m of r.missed) expect(merged.some((x) => x.epc === m)).toBe(false);
  });

  it('is repeatable with the same seed and different with another', () => {
    const a = runScenario({ expected: forty, missed: 2, strays: 1, seed: 3 }, start);
    const b = runScenario({ expected: forty, missed: 2, strays: 1, seed: 3 }, start);
    const c = runScenario({ expected: forty, missed: 2, strays: 1, seed: 4 }, start);
    expect(b.reads).toEqual(a.reads);
    expect(c.missed).not.toEqual(a.missed);
  });

  it('keeps reads in time order, within the duration, with plausible signal', () => {
    const r = runScenario({ expected: forty, missed: 0, strays: 2, durationMs: 5000, seed: 1 }, start);
    for (let i = 1; i < r.reads.length; i += 1) expect(r.reads[i]!.readAt >= r.reads[i - 1]!.readAt).toBe(true);
    for (const read of r.reads) {
      expect(read.readAt.getTime() - start.getTime()).toBeLessThan(5000);
      expect(read.rssi).toBeLessThan(-40);
      expect(read.rssi).toBeGreaterThan(-85);
    }
    // Strays are further away, so weaker than the load.
    const strongestStray = Math.max(...r.reads.filter((x) => r.strays.includes(x.epc)).map((x) => x.rssi!));
    expect(strongestStray).toBeLessThan(-66);
  });

  it('uses given stray tags and rejects impossible scenarios', () => {
    const r = runScenario({ expected: forty.slice(0, 3), missed: 0, strays: 1, strayEpcs: ['ABCDEF0123456789'] }, start);
    expect(r.strays).toEqual(['ABCDEF0123456789']);
    expect(() => runScenario({ expected: forty.slice(0, 2), missed: 3, strays: 0 })).toThrow(RangeError);
  });

  it('makes valid 96-bit tag numbers', () => {
    expect(randomEpc(seededRandom(9))).toMatch(/^[0-9A-F]{24}$/);
  });
});

describe('parseScript', () => {
  it('reads purposes and counts', () => {
    expect(parseScript('dispatch 40 miss 2 stray 1')).toEqual({ purpose: 'dispatch', count: 40, missed: 2, strays: 1 });
    expect(parseScript('Stocktake 12 strays 3 reads 2-4 seed 5 for 10s')).toEqual({
      purpose: 'stocktake', count: 12, missed: 0, strays: 3, readsPerTag: [2, 4], seed: 5, durationMs: 10_000,
    });
  });

  it('explains mistakes', () => {
    expect(() => parseScript('dispatch')).toThrow(SyntaxError);
    expect(() => parseScript('dispatch 4 miss 5')).toThrow(/more tags/);
    expect(() => parseScript('dispatch 4 wobble 1')).toThrow(/wobble/);
  });
});

describe('SimulatedReader', () => {
  it('delivers every read of the scenario in bursts, then stops', async () => {
    vi.useFakeTimers();
    try {
      const reader = new SimulatedReader({ expected: forty.slice(0, 5), missed: 1, strays: 1, durationMs: 1000, seed: 2 }, { burstMs: 100 });
      const got: string[] = [];
      let bursts = 0;
      reader.onReads((reads) => {
        bursts += 1;
        got.push(...reads.map((r) => r.epc));
      });
      await reader.start();
      await vi.advanceTimersByTimeAsync(1500);
      expect(new Set(got).size).toBe(5);
      expect(bursts).toBeGreaterThan(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('ReaderApiClient', () => {
  it('signs in with the device credential, then uploads in batches with retry on server errors', async () => {
    const calls: { url: string; auth: string | undefined; body: Record<string, unknown> | undefined }[] = [];
    let failOnce = true;
    const fake = (async (url: string, init: RequestInit) => {
      const headers = init.headers as Record<string, string>;
      const body = init.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined;
      calls.push({ url, auth: headers['authorization'], body });
      if (url.endsWith('/auth/device/sign-in')) return new Response(JSON.stringify({ token: 'tok' }), { status: 200 });
      if (url.endsWith('/scan-sessions')) return new Response(JSON.stringify({ id: 'S1' }), { status: 201 });
      if (url.endsWith('/reads')) {
        if (failOnce) {
          failOnce = false;
          return new Response(JSON.stringify({ error: 'oops' }), { status: 503 });
        }
        return new Response(JSON.stringify({ accepted: (body!.reads as unknown[]).length }), { status: 200 });
      }
      return new Response(null, { status: 204 });
    }) as unknown as typeof fetch;

    const client = new ReaderApiClient('http://api.test/', fake);
    await client.signIn({ credential: 'C', phone: '0700000002', pin: '123456' });
    expect(calls[0]!.auth).toBe('Device C');
    const id = await client.openSession({ purpose: 'dispatch', locationId: 'L' });
    expect(calls[1]!.auth).toBe('Bearer tok');

    const reads = runScenario({ expected: forty, missed: 0, strays: 0, readsPerTag: [15, 15], seed: 1 }, start).reads;
    expect(reads).toHaveLength(600);
    const sent = await client.sendReads(id, reads);
    expect(sent).toEqual({ batches: 2, accepted: 600 });
    const uploads = calls.filter((c) => c.url.endsWith('/reads'));
    // The failed first batch was retried with the same batch id.
    expect(uploads).toHaveLength(3);
    expect(uploads[0]!.body!.batchId).toBe(uploads[1]!.body!.batchId);
    expect(uploads[2]!.body!.batchId).not.toBe(uploads[0]!.body!.batchId);
  });

  it('does not retry a refusal', async () => {
    let n = 0;
    const fake = (async () => {
      n += 1;
      return new Response(JSON.stringify({ error: 'session_closed', message: 'closed' }), { status: 409 });
    }) as unknown as typeof fetch;
    const client = new ReaderApiClient('http://api.test', fake);
    await expect(client.sendReads('S', [{ epc: 'AA', rssi: null, antenna: null, readAt: start }])).rejects.toBeInstanceOf(ApiError);
    expect(n).toBe(1);
  });
});
