'use client';

import { useActionState } from 'react';
import { FormMessage, SubmitButton } from '@/components/form-bits';
import { getMessages } from '@/i18n';
import type { SendCodeState } from '../../actions';

/** Sends the shop its code. If the handover doesn't balance, the driver must accept the shortfall to go on. */
export function SendCodeForm({ action, uncovered }: { action: (prev: SendCodeState, fd: FormData) => Promise<SendCodeState>; uncovered: number }) {
  const f = getMessages().field;
  const [state, run] = useActionState<SendCodeState, FormData>(action, {});
  const shortfall = state.shortfall ?? 0;
  // The page knows the balance before any try, so the checkbox can be offered straight away.
  const showAccept = shortfall > 0 || state.error === 'unbalanced' || uncovered > 0;
  return (
    <form action={run} className="flex flex-col gap-3">
      {state.error === 'unbalanced' ? null : <FormMessage state={state} />}
      <p>{f.sendHint}</p>
      {showAccept ? (
        <div className={state.error === 'unbalanced' ? 'rounded-md border-2 border-current p-3' : ''} role={state.error === 'unbalanced' ? 'alert' : undefined}>
          <p className="mb-2 font-semibold">{f.shortfall(shortfall || uncovered)}</p>
          <label className="flex min-h-11 items-center gap-3 text-lg">
            <input type="checkbox" name="acceptShortfall" className="h-6 w-6" />
            {f.acceptShortfall}
          </label>
        </div>
      ) : null}
      <div>
        <SubmitButton label={f.sendCode} working={f.sendingCode} />
      </div>
    </form>
  );
}
