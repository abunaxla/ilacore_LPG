'use client';

import { useActionState } from 'react';
import { Field, Select } from '@/components/fields';
import { FormMessage, SubmitButton } from '@/components/form-bits';
import { getMessages } from '@/i18n';
import { addShopAction, type AddShopState } from '../actions';

export function AddShopForm({ wholesalers }: { wholesalers: { id: string; name: string }[] }) {
  const c = getMessages().customers;
  const [state, run] = useActionState<AddShopState, FormData>(addShopAction, {});
  const v = state.values ?? {};
  const wrong = new Set(state.fields ?? []);
  const invalid = (name: string) => (wrong.has(name) ? { 'aria-invalid': true as const } : {});

  return (
    // The key remounts the form after each try, so the fields show what came back.
    <form key={state.seq ?? 0} action={run} className="flex max-w-2xl flex-col gap-5" noValidate>
      <FormMessage state={state} />
      {wrong.size > 0 ? (
        <div role="alert" className="rounded-md border-2 border-current p-3">
          <p className="font-semibold">{c.checkFields}</p>
          <ul className="list-disc pl-6">
            {[...wrong].map((f) => <li key={f}>{c.fields[f] ?? f}</li>)}
          </ul>
        </div>
      ) : null}
      <Select name="kind" label={c.kind} defaultValue={v['kind'] || 'retailer'}>
        <option value="retailer">{c.kinds.retailer}</option>
        <option value="wholesaler">{c.kinds.wholesaler}</option>
      </Select>
      <Field name="name" label={c.name} required maxLength={80} autoComplete="off" defaultValue={v['name'] ?? ''} {...invalid('name')} />
      <Field name="phone" label={c.phone} hint={c.phoneHint} required type="tel" inputMode="tel" autoComplete="off" defaultValue={v['phone'] ?? ''} {...invalid('phone')} />
      <Field name="area" label={c.area} hint={c.areaHint} maxLength={120} autoComplete="off" defaultValue={v['area'] ?? ''} {...invalid('area')} />
      <div className="flex flex-col gap-1">
        <Select name="billedThrough" label={c.billedThrough} defaultValue={v['billedThrough'] ?? ''} aria-describedby="billed-hint" {...invalid('billedThrough')}>
          <option value="">{c.noWholesaler}</option>
          {wholesalers.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
        </Select>
        <p id="billed-hint" className="text-base">{c.billedHint}</p>
      </div>
      <div>
        <SubmitButton label={c.submit} working={c.working} />
      </div>
    </form>
  );
}
