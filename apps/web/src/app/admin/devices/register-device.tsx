'use client';

import { useActionState } from 'react';
import { Field, Select } from '@/components/fields';
import { FormMessage, SubmitButton } from '@/components/form-bits';
import { getMessages } from '@/i18n';
import { registerDeviceAction, type DeviceFormState } from '../actions';

/** Registers a device and shows its credential once. */
export function RegisterDevice({ locations }: { locations: { id: string; name: string }[] }) {
  const t = getMessages();
  const d = t.devices;
  const [state, run] = useActionState<DeviceFormState, FormData>(registerDeviceAction, {});
  return (
    <div className="flex flex-col gap-4">
      {state.credential ? (
        <section aria-labelledby="cred" role="status" className="rounded-md border-4 border-double border-current p-4">
          <h3 id="cred" className="text-xl font-bold">{d.credentialTitle}</h3>
          <p className="my-2">{d.credentialIntro}</p>
          <p className="break-all rounded-md border-2 border-current p-3 font-mono text-base">{state.credential}</p>
        </section>
      ) : (
        <FormMessage state={state} />
      )}
      <form action={run} className="grid gap-4 md:grid-cols-3">
        <Field name="name" label={d.name} hint={d.nameHint} required autoComplete="off" />
        <Select name="kind" label={d.kind} required>
          <option value="handheld">{d.handheld}</option>
          <option value="reader">{d.reader}</option>
        </Select>
        <Select name="locationId" label={d.location}>
          <option value="">{d.none}</option>
          {locations.map((l) => (
            <option key={l.id} value={l.id}>{l.name}</option>
          ))}
        </Select>
        <div>
          <SubmitButton label={d.register} working={t.admin.working} />
        </div>
      </form>
    </div>
  );
}