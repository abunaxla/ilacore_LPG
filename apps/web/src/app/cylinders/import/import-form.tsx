'use client';

import { useActionState } from 'react';
import { inputClass, Select } from '@/components/fields';
import { FormMessage, SubmitButton } from '@/components/form-bits';
import { getMessages } from '@/i18n';
import { importCylindersAction, type ImportState } from '../actions';

const EXAMPLE = 'tag\tsize\tserial\tmanufacturer\tlast test\tstate\nE28011606000020700001234\t13 kg\tAB1001\tKenpipe\t2024-03-01\tfull';

export function ImportForm({ places }: { places: { id: string; name: string }[] }) {
  const t = getMessages();
  const m = t.importCylinders;
  const [state, run] = useActionState<ImportState, FormData>(importCylindersAction, {});

  return (
    <form key={state.seq ?? 0} action={run} className="flex flex-col gap-5">
      <FormMessage state={state} />
      {state.problems && state.problems.length > 0 ? (
        <div role="alert" className="rounded-md border-2 border-current p-3">
          <p className="mb-2 font-semibold">{m.problems}</p>
          <ul className="flex flex-col gap-1">
            {state.problems.map((p) => (
              <li key={p.line}>
                <strong>{m.row(p.line)}:</strong> {p.messages.join(' ')}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <Select name="locationId" label={t.registerCylinder.location} required defaultValue={state.locationId ?? places[0]?.id}>
        {places.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </Select>
      <div className="flex flex-col gap-1">
        <label htmlFor="import-rows" className="font-semibold">{m.rows}</label>
        <textarea
          id="import-rows"
          name="rows"
          rows={14}
          required
          spellCheck={false}
          placeholder={EXAMPLE}
          defaultValue={state.text ?? ''}
          className={`${inputClass} font-mono text-base`}
        />
      </div>
      <div>
        <SubmitButton label={m.submit} working={m.working} />
      </div>
    </form>
  );
}
