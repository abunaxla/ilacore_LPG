'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { buttonClass } from '@/components/fields';
import { getMessages } from '@/i18n';
import { CHANGED, enqueue, getResults, listOps, type Direction, type ScanResults } from '@/lib/field-outbox';

/**
 * Scanning for a handover. Each Enter puts the tags in the handheld's outbox with the direction chosen at that
 * moment and empties the box at once, so a reader that types like a keyboard is never slowed down and nothing is
 * lost with no signal. What came back (added, and every warning) is shown as it arrives; scans not sent yet are
 * counted separately because the balance does not include them. The RFID reader plugs in here once it is chosen.
 */
export function ScanForm({ handoverId, refreshOnSend = true }: { handoverId: string; refreshOnSend?: boolean }) {
  const f = getMessages().field;
  const router = useRouter();
  const [direction, setDirection] = useState<Direction>('out');
  const [results, setResults] = useState<ScanResults>({ handoverId, added: 0, outcomes: [] });
  const [unsent, setUnsent] = useState(0);
  const box = useRef<HTMLInputElement>(null);
  const lastUnsent = useRef(0);

  useEffect(() => {
    const update = async () => {
      const [r, ops] = await Promise.all([getResults(handoverId), listOps()]);
      const n = ops.filter((o) => o.kind === 'scan' && o.handoverId === handoverId && !o.failed).reduce((sum, o) => sum + (o.kind === 'scan' ? o.epcs.length : 0), 0);
      setResults(r);
      setUnsent(n);
      // Something was just sent: show the new lines and balance.
      if (refreshOnSend && n < lastUnsent.current) router.refresh();
      lastUnsent.current = n;
    };
    void update();
    window.addEventListener(CHANGED, update);
    return () => window.removeEventListener(CHANGED, update);
  }, [handoverId, refreshOnSend, router]);

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const input = box.current;
    const epcs = [...new Set((input?.value ?? '').toUpperCase().split(/[\s,;]+/).filter(Boolean))];
    if (input) {
      input.value = '';
      input.focus();
    }
    if (epcs.length > 0) void enqueue({ kind: 'scan', handoverId, direction, epcs });
  };

  const notable = results.outcomes;
  return (
    <form onSubmit={submit} data-offline-ok className="flex flex-col gap-4">
      <div role="group" aria-labelledby="scan-direction">
        <p id="scan-direction" className="mb-2 font-semibold">{f.scanTitle}</p>
        <div className="flex gap-2">
          {(['out', 'in'] as const).map((d) => (
            <button
              key={d}
              type="button"
              aria-pressed={direction === d}
              onClick={() => {
                setDirection(d);
                box.current?.focus();
              }}
              className={`flex min-h-11 flex-1 items-center justify-center rounded-md border-2 border-current px-3 text-lg font-semibold ${direction === d ? 'bg-foreground text-background' : ''}`}
            >
              {d === 'out' ? f.scanningOut : f.scanningIn}
            </button>
          ))}
        </div>
      </div>
      <div role="status" className={results.added || notable.length || unsent ? 'rounded-md border-2 border-dashed border-current p-3' : ''}>
        {unsent > 0 ? <p className="font-semibold">⚠ {f.notCountedYet(unsent)}</p> : null}
        {results.added ? <p className="font-semibold">{f.outcomes['added']} ({results.added})</p> : null}
        {notable.length > 0 ? (
          <ul>
            {notable.map((o, i) => (
              <li key={`${o.epc}-${i}`} className="font-mono text-base">
                {o.epc}: <span className="font-sans">{f.outcomes[o.reason ?? o.result] ?? o.reason ?? o.result}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="tags" className="font-semibold">{f.tags}</label>
        <p id="tags-hint" className="text-base">{f.tagsHint}</p>
        <input
          ref={box}
          id="tags"
          name="tags"
          aria-describedby="tags-hint"
          autoFocus
          autoComplete="off"
          spellCheck={false}
          autoCapitalize="characters"
          className="block w-full rounded-md border-2 border-current bg-transparent px-3 py-2 font-mono text-lg"
        />
      </div>
      <div>
        <button type="submit" className={buttonClass}>{f.scan}</button>
      </div>
    </form>
  );
}
