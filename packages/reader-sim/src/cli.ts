#!/usr/bin/env node
/**
 * Plays a scenario against the API as a registered reader.
 *
 *   reader-sim --script "dispatch 40 miss 2 stray 1" --epcs tags.txt --location <location id>
 *   reader-sim --script "stocktake 12 stray 3" --epcs tags.txt --dry-run
 *
 * The tag file has one tag number per line (the first N are used). Secrets come from the environment,
 * never from arguments (arguments end up in shell history):
 *   READER_API_URL (default http://127.0.0.1:3001), READER_CREDENTIAL, READER_PHONE, READER_PIN
 */
import { mergeReads } from '@ilacore/domain';
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { ReaderApiClient } from './api-client.js';
import { parseScript, runScenario } from './scenario.js';

const { values } = parseArgs({
  options: {
    script: { type: 'string' },
    epcs: { type: 'string' },
    location: { type: 'string' },
    'dry-run': { type: 'boolean', default: false },
  },
});

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

if (!values.script) fail('Give a --script, e.g. --script "dispatch 40 miss 2 stray 1"');
let plan: ReturnType<typeof parseScript>;
try {
  plan = parseScript(values.script);
} catch (error) {
  fail((error as Error).message);
}
const tagFile = values.epcs ? readFileSync(values.epcs, 'utf8') : '';
const known = tagFile.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
if (known.length < plan.count) fail(`The scenario needs ${plan.count} tag numbers; the --epcs file has ${known.length}.`);

const result = runScenario({
  expected: known.slice(0, plan.count),
  missed: plan.missed,
  strays: plan.strays,
  ...(plan.readsPerTag ? { readsPerTag: plan.readsPerTag } : {}),
  ...(plan.durationMs ? { durationMs: plan.durationMs } : {}),
  seed: plan.seed ?? Date.now() % 100_000,
});
const merged = mergeReads(result.reads);
process.stdout.write(
  `${plan.purpose}: ${result.reads.length} raw reads of ${merged.length} tags ` +
    `(${result.seen.length} expected seen, ${result.missed.length} missed, ${result.strays.length} strays)\n`,
);
for (const m of result.missed) process.stdout.write(`  missed  ${m}\n`);
for (const s of result.strays) process.stdout.write(`  stray   ${s}\n`);

if (!values['dry-run']) {
  if (!values.location) fail('Give the --location id where the scan happens (or use --dry-run).');
  const env = process.env;
  if (!env.READER_CREDENTIAL || !env.READER_PHONE || !env.READER_PIN) {
    fail('Set READER_CREDENTIAL, READER_PHONE and READER_PIN in the environment.');
  }
  const client = new ReaderApiClient(env.READER_API_URL ?? 'http://127.0.0.1:3001');
  try {
    await client.signIn({ credential: env.READER_CREDENTIAL, phone: env.READER_PHONE, pin: env.READER_PIN });
    const sessionId = await client.openSession({ purpose: plan.purpose, locationId: values.location, note: `Simulator: ${values.script}` });
    const sent = await client.sendReads(sessionId, result.reads);
    await client.closeSession(sessionId);
    process.stdout.write(`Sent ${sent.accepted} reads in ${sent.batches} batch(es) to scan session ${sessionId}.\n`);
  } catch (error) {
    fail(`The API refused it: ${(error as Error).message}`);
  } finally {
    await client.signOut();
  }
}
