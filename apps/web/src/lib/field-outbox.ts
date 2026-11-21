/**
 * The handheld's outbox (browser only). Starting a handover and scanning are written here first and then sent
 * in order, so they work with no signal and nothing is lost when the reply never arrives:
 * - Sending something twice is harmless: a handover start carries an id chosen here, and a tag already on the
 *   handover just comes back "already scanned".
 * - Only one tab sends at a time (a Web Lock).
 * - No signal, a server error or an expired sign-in keeps the item and tries again later. A refusal (the
 *   handover was cancelled meanwhile, the trip is not out…) is kept as "could not be sent" for the driver to see.
 * Everything that changes counts or custody beyond scanning (bought, owed, the shop's code) is not queued: it
 * needs signal, so the server decides it at the moment it happens.
 */

export type Direction = 'out' | 'in';
export type OpInput =
  | { kind: 'start'; handoverId: string; tripId: string; customerId: string; shopName: string }
  | { kind: 'scan'; handoverId: string; direction: Direction; epcs: string[] };
export type Op = OpInput & { seq?: number; at: number; failed?: string };
export interface Outcome {
  epc: string;
  result: string;
  reason?: string;
}
/** What came back for a handover's scans: added count and everything not simply added, newest first. */
export interface ScanResults {
  handoverId: string;
  added: number;
  outcomes: Outcome[];
}
export type SyncState = 'idle' | 'sending' | 'offline' | 'signin';

const DB = 'ilacore-field';
const OPS = 'outbox';
const RESULTS = 'results';
const SHOPS = 'shops';
export const CHANGED = 'field-outbox-changed';

let dbPromise: Promise<IDBDatabase> | undefined;
function db(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const open = indexedDB.open(DB, 1);
    open.onupgradeneeded = () => {
      open.result.createObjectStore(OPS, { keyPath: 'seq', autoIncrement: true });
      open.result.createObjectStore(RESULTS, { keyPath: 'handoverId' });
      open.result.createObjectStore(SHOPS, { keyPath: 'key' });
    };
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error);
  });
  return dbPromise;
}

function run<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return db().then(
    (d) =>
      new Promise<T>((resolve, reject) => {
        const tx = d.transaction(store, mode);
        const req = fn(tx.objectStore(store));
        tx.oncomplete = () => resolve(req.result);
        tx.onerror = () => reject(tx.error);
      }),
  );
}

const changed = () => window.dispatchEvent(new Event(CHANGED));

export async function listOps(): Promise<Op[]> {
  return run<Op[]>(OPS, 'readonly', (s) => s.getAll() as IDBRequest<Op[]>);
}

/** Keeps the item, then tries to send everything waiting. Resolves to how that attempt ended. */
export async function enqueue(op: OpInput): Promise<SyncState> {
  await run(OPS, 'readwrite', (s) => s.add({ ...op, at: Date.now() }));
  changed();
  return sync();
}

export async function dismiss(seq: number): Promise<void> {
  await run(OPS, 'readwrite', (s) => s.delete(seq));
  changed();
}

export async function getResults(handoverId: string): Promise<ScanResults> {
  const r = await run<ScanResults | undefined>(RESULTS, 'readonly', (s) => s.get(handoverId) as IDBRequest<ScanResults | undefined>);
  return r ?? { handoverId, added: 0, outcomes: [] };
}

async function addResults(handoverId: string, outcomes: Outcome[]): Promise<void> {
  const prev = await getResults(handoverId);
  const added = outcomes.filter((o) => o.result === 'added').length;
  const notable = outcomes.filter((o) => o.result !== 'added').reverse();
  await run(RESULTS, 'readwrite', (s) =>
    s.put({ handoverId, added: prev.added + added, outcomes: [...notable, ...prev.outcomes].slice(0, 20) } satisfies ScanResults),
  );
}

/** The shop list kept for searching with no signal (drivers never get numbers). */
export interface SavedShop {
  id: string;
  name: string;
  area: string | null;
  labelCode: string;
  phoneVerified: boolean;
}
export async function saveShops(shops: SavedShop[]): Promise<void> {
  await run(SHOPS, 'readwrite', (s) => s.put({ key: 'all', shops, savedAt: Date.now() }));
}
export async function savedShops(): Promise<SavedShop[]> {
  const r = await run<{ shops: SavedShop[] } | undefined>(SHOPS, 'readonly', (s) => s.get('all') as IDBRequest<{ shops: SavedShop[] } | undefined>);
  return r?.shops ?? [];
}

let state: SyncState = 'idle';
export const syncState = () => state;
/** The browser says the connection went (when it says so, it is right; when it says online, it may not be). */
export const markOffline = () => setState('offline');
function setState(s: SyncState) {
  if (s !== state) {
    state = s;
    changed();
  }
}

/** Sends what is waiting, oldest first. If another tab is already sending, leaves it to that tab. */
export async function sync(): Promise<SyncState> {
  if (!('locks' in navigator)) return syncNow();
  return navigator.locks.request('ilacore-field-sync', { ifAvailable: true }, async (lock) => (lock ? syncNow() : state));
}

async function syncNow(): Promise<SyncState> {
  for (;;) {
    const next = (await listOps()).find((o) => !o.failed);
    if (!next) {
      // Nothing to send: just check the server can be reached, so screens can say "needs signal" up front.
      try {
        await fetch('/field/sync', { method: 'HEAD', cache: 'no-store' });
      } catch {
        setState('offline');
        return 'offline';
      }
      setState('idle');
      return 'idle';
    }
    setState('sending');
    let res: Response;
    try {
      res = await fetch('/field/sync', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(next),
        cache: 'no-store',
      });
    } catch {
      setState('offline');
      return 'offline';
    }
    if (res.status === 401) {
      setState('signin');
      return 'signin';
    }
    if (res.status >= 500 || res.status === 429) {
      setState('offline');
      return 'offline';
    }
    const body = (await res.json().catch(() => ({}))) as { error?: string; outcomes?: Outcome[] };
    if (res.ok) {
      if (next.kind === 'scan') await addResults(next.handoverId, body.outcomes ?? []);
      await run(OPS, 'readwrite', (s) => s.delete(next.seq!));
    } else {
      await run(OPS, 'readwrite', (s) => s.put({ ...next, failed: body.error ?? 'unknown' }));
    }
    changed();
  }
}
