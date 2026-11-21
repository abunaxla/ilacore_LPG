'use client';

import { useActionState, useState } from 'react';
import { FormMessage, SubmitButton } from '@/components/form-bits';
import { getMessages } from '@/i18n';
import type { ScanState } from '../../actions';

/**
 * Scanning for a handover. A reader that types like a keyboard sends each tag followed by Enter, which adds it
 * straight away; the box is ready again for the next one. The RFID reader plugs in here once it is chosen.
 */
export function ScanForm({ action }: { action: (prev: ScanState, fd: FormData) => Promise<ScanState> }) {
  const f = getMessages().field;
  const [state, run] = useActionState<ScanState, FormData>(action, {});
  const [direction, setDirection] = useState<'out' | 'in'>('out');
  const refused = (state.outcomes ?? []).filter((o) => o.result !== 'added');
  const added = (state.outcomes ?? []).length - refused.length;

  return (
    <form action={run} className="flex flex-col gap-4">
      <fieldset className="flex gap-2">
        <legend className="mb-2 font-semibold">{f.scanTitle}</legend>
        {(['out', 'in'] as const).map((d) => (
          <label
            key={d}
            className={`flex min-h-11 flex-1 cursor-pointer items-center justify-center rounded-md border-2 border-current px-3 text-lg font-semibold has-[:focus-visible]:outline ${direction === d ? 'bg-foreground text-background' : ''}`}
          >
            <input type="radio" name="direction" value={d} checked={direction === d} onChange={() => setDirection(d)} className="sr-only" />
            {d === 'out' ? f.scanningOut : f.scanningIn}
          </label>
        ))}
      </fieldset>
      <FormMessage state={state} />
      {state.outcomes ? (
        <div role="status" className="rounded-md border-2 border-dashed border-current p-3">
          {added > 0 ? <p className="font-semibold">{f.outcomes['added']} ({added})</p> : null}
          <ul>
            {refused.map((o) => (
              <li key={o.epc} className="font-mono text-base">
                {o.epc}: <span className="font-sans">{f.outcomes[o.reason ?? o.result] ?? o.reason ?? o.result}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="flex flex-col gap-1">
        <label htmlFor="tags" className="font-semibold">{f.tags}</label>
        <p id="tags-hint" className="text-base">{f.tagsHint}</p>
        {/* Keyed so it comes back empty and focused after each scan, while the direction stays as chosen. */}
        <input
          key={state.seq ?? 0}
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
        <SubmitButton label={f.scan} working={f.scanningNow} />
      </div>
    </form>
  );
}
