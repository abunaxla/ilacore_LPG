'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { Field, Select } from '@/components/fields';
import { FormMessage, SubmitButton } from '@/components/form-bits';
import { getMessages } from '@/i18n';
import { registerCylinderAction, type RegisterState } from '../actions';

interface Option {
  id: string;
  name: string;
}

export function RegisterForm({ places, sizes, intervalSet }: { places: Option[]; sizes: Option[]; intervalSet: boolean }) {
  const t = getMessages();
  const r = t.registerCylinder;
  const [state, run] = useActionState<RegisterState, FormData>(registerCylinderAction, {});
  const v = state.values ?? {};
  const wrong = new Set(state.problem?.fields ?? []);
  const reason = state.problem?.reason as keyof typeof r.reasons | undefined;
  const invalid = (name: string) => (wrong.has(name) ? { 'aria-invalid': true as const } : {});

  return (
    // The key remounts the form after each try, so the fields show what came back in the state.
    <form key={state.seq ?? 0} action={run} className="flex flex-col gap-5" noValidate>
      <FormMessage state={state} />
      {state.createdId ? (
        <p className="flex flex-wrap gap-4">
          <Link href={`/cylinders/${state.createdId}`} className="underline underline-offset-4">{r.view}</Link>
          <span>{r.another} ↓</span>
        </p>
      ) : null}
      {state.problem ? (
        <div role="alert" className="rounded-md border-2 border-current p-3">
          {reason ? <p className="font-semibold">{r.reasons[reason]}</p> : null}
          {!reason && state.problem.fields.length > 0 ? (
            <>
              <p className="font-semibold">{r.checkFields}</p>
              <ul className="list-disc pl-6">
                {state.problem.fields.map((f) => <li key={f}>{r.fields[f as keyof typeof r.fields] ?? f}</li>)}
              </ul>
            </>
          ) : null}
        </div>
      ) : null}

      <div className="grid gap-5 md:grid-cols-2">
        <Select name="locationId" label={r.location} required defaultValue={v['locationId'] ?? places[0]?.id}>
          {places.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </Select>
        <Select name="sizeId" label={r.size} required defaultValue={v['sizeId'] ?? ''} {...invalid('sizeId')}>
          <option value="" disabled>—</option>
          {sizes.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </Select>
        <Field
          name="epc"
          label={r.epc}
          hint={r.epcHint}
          required
          autoComplete="off"
          spellCheck={false}
          autoCapitalize="characters"
          defaultValue={v['epc'] ?? ''}
          {...invalid('epc')}
        />
        <Select name="physicalState" label={r.state} defaultValue={v['physicalState'] || 'empty'}>
          <option value="empty">{t.cylinders.physical.empty}</option>
          <option value="full">{t.cylinders.physical.full}</option>
        </Select>
        <Field name="serial" label={r.serial} autoComplete="off" defaultValue={v['serial'] ?? ''} {...invalid('serial')} />
        <Field name="manufacturer" label={r.manufacturer} autoComplete="off" defaultValue={v['manufacturer'] ?? ''} {...invalid('manufacturer')} />
        <Field name="manufacturedOn" type="date" label={r.manufacturedOn} defaultValue={v['manufacturedOn'] ?? ''} {...invalid('manufacturedOn')} />
        <Field name="tareKg" label={r.tareKg} hint={r.tareHint} inputMode="decimal" autoComplete="off" defaultValue={v['tareKg'] ?? ''} {...invalid('tareKg')} />
        <Field name="lastTestOn" type="date" label={r.lastTestOn} defaultValue={v['lastTestOn'] ?? ''} {...invalid('lastTestOn')} />
        <Field name="nextTestDue" type="date" label={r.nextTestDue} hint={r.nextTestHint} defaultValue={v['nextTestDue'] ?? ''} {...invalid('nextTestDue')} />
      </div>
      <p>{intervalSet ? r.noTestNote : `${r.noTestNote} ${t.cylinderSettings.intervalNotSet}`}</p>
      <div>
        <SubmitButton label={r.submit} working={r.working} />
      </div>
    </form>
  );
}
