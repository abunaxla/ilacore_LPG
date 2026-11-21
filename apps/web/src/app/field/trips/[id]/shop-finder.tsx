'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { buttonClass, Field } from '@/components/fields';
import { errorText, getMessages } from '@/i18n';
import { dismiss, enqueue, listOps, savedShops, saveShops, type SavedShop } from '@/lib/field-outbox';

/**
 * Find a shop and start the handover. With signal the server searches; with none, the shops kept on this
 * handheld are searched. Starting goes through the outbox with an id chosen here, so it works with no signal and
 * starting twice (a double tap, a resend) is still one handover.
 */
export function ShopFinder({ tripId }: { tripId: string }) {
  const f = getMessages().field;
  const [shops, setShops] = useState<SavedShop[] | null>(null);
  const [fromSaved, setFromSaved] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [starting, setStarting] = useState<string | undefined>();
  const [searching, setSearching] = useState(false);

  // Keep the shop list on the handheld while there is signal.
  useEffect(() => {
    fetch('/field/shops', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((list: SavedShop[] | null) => (list ? saveShops(list) : undefined))
      .catch(() => undefined);
  }, []);

  const search = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const q = String(new FormData(e.currentTarget).get('q') ?? '').trim();
    if (!q) return;
    setError(undefined);
    setSearching(true);
    try {
      const r = await fetch(`/field/shops?q=${encodeURIComponent(q)}`, { cache: 'no-store' });
      if (r.status < 500) {
        const body = await r.json();
        setSearching(false);
        if (!r.ok) {
          setError(errorText(body.error));
          return;
        }
        setShops(body as SavedShop[]);
        setFromSaved(false);
        return;
      }
    } catch {
      // No signal: search what is kept here.
    }
    setSearching(false);
    const needle = q.toLowerCase();
    const all = await savedShops();
    setShops(all.filter((s) => s.name.toLowerCase().includes(needle) || (s.area ?? '').toLowerCase().includes(needle) || s.labelCode === q.toUpperCase()));
    setFromSaved(true);
  };

  const start = async (shop: SavedShop) => {
    if (starting) return;
    const id = crypto.randomUUID();
    setStarting(shop.id);
    setError(undefined);
    const state = await enqueue({ kind: 'start', handoverId: id, tripId, customerId: shop.id, shopName: shop.name });
    const op = (await listOps()).find((o) => o.kind === 'start' && o.handoverId === id);
    if (op?.failed) {
      // Refused at once (a handover already in progress, say): say so here rather than in the outbox.
      setError(errorText(op.failed));
      await dismiss(op.seq!);
      setStarting(undefined);
      return;
    }
    window.location.assign(state === 'idle' && !op ? `/field/handovers/${id}` : `/field/offline-handover#${id}`);
  };

  return (
    <>
      <form onSubmit={search} data-offline-ok className="mb-4 flex flex-col gap-3">
        <Field name="q" label={f.findShop} autoComplete="off" required />
        <div>
          <button type="submit" className={buttonClass} disabled={searching}>{searching ? f.searching : f.find}</button>
        </div>
      </form>
      {error ? <p role="alert" className="mb-3 rounded-md border-2 border-current p-3">⚠ {error}</p> : null}
      <div role="status">
        {searching ? <p className="sr-only">{f.searching}</p> : null}
        {fromSaved && !searching ? <p className="mb-3">{f.savedShops}</p> : null}
      </div>
      {shops && shops.length === 0 ? <p role="status">{f.noShops}</p> : null}
      {shops && shops.length > 0 ? (
        <ul className="flex flex-col gap-3">
          {shops.map((s) => (
            <li key={s.id} className="rounded-md border-2 border-current p-3">
              <p className="font-semibold">{s.name}</p>
              <p className="mb-2">
                {s.area ? `${s.area} · ` : ''}<span className="font-mono">{s.labelCode}</span>
                {s.phoneVerified ? '' : ` · ${f.notChecked}`}
              </p>
              {s.phoneVerified ? (
                <button type="button" className={buttonClass} disabled={!!starting} onClick={() => void start(s)}>
                  {starting === s.id ? f.starting : f.start}
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
}
