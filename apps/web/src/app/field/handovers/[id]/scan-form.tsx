'use client';

import { startTransition, useActionState, useEffect, useRef, useState, type FormEvent } from 'react';
import { buttonClass } from '@/components/fields';
import { FormMessage } from '@/components/form-bits';
import { getMessages } from '@/i18n';
import type { ScanState } from '../../actions';

type Direction = 'out' | 'in';

/**
 * Scanning for a handover. A reader that types like a keyboard sends each tag followed by Enter, often faster
 * than the server answers. So the box never waits: each Enter moves the tags into a queue at once (with the
 * direction chosen at that moment) and the box is empty and focused for the next tag. The queue is sent one
 * batch at a time. The RFID reader plugs in here once it is chosen.
 */
export function ScanForm({ action }: { action: (prev: ScanState, fd: FormData) => Promise<ScanState> }) {
  const f = getMessages().field;
  const [state, dispatch, pending] = useActionState<ScanState, FormData>(action, {});
  const [direction, setDirection] = useState<Direction>('out');
  const [waiting, setWaiting] = useState(0);
  const queue = useRef<{ direction: Direction; tags: string }[]>([]);
  const box = useRef<HTMLInputElement>(null);

  // Sends the next batch: every queued entry with the same direction as the first one.
  const flush = () => {
    const first = queue.current[0];
    if (!first) return;
    const batch = queue.current.filter((q) => q.direction === first.direction);
    queue.current = queue.current.filter((q) => q.direction !== first.direction);
    setWaiting(queue.current.length);
    const fd = new FormData();
    fd.set('direction', first.direction);
    fd.set('tags', batch.map((q) => q.tags).join('\n'));
    startTransition(() => dispatch(fd));
  };

  // When a batch comes back, send whatever was scanned meanwhile.
  useEffect(() => {
    if (!pending && queue.current.length > 0) flush();
    // flush only reads refs and stable setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending]);

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const input = box.current;
    const tags = input?.value.trim() ?? '';
    if (input) {
      input.value = '';
      input.focus();
    }
    if (!tags) return;
    queue.current.push({ direction, tags });
    setWaiting(queue.current.length);
    if (!pending) flush();
  };

  const notable = state.outcomes ?? [];
  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
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
      <FormMessage state={{ ...(state.error ? { error: state.error } : {}) }} />
      <div role="status" className={state.added || notable.length || pending ? 'rounded-md border-2 border-dashed border-current p-3' : ''}>
        {pending || waiting > 0 ? <p>{f.scanningNow}</p> : null}
        {state.added ? <p className="font-semibold">{f.outcomes['added']} ({state.added})</p> : null}
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
