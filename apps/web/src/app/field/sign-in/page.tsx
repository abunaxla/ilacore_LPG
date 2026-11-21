import { redirect } from 'next/navigation';
import { Suspense } from 'react';
import { FieldLoading } from '../field-loading';
import { ActionForm } from '@/components/action-form';
import { Field, secondaryButtonClass } from '@/components/fields';
import { getMessages } from '@/i18n';
import { getDeviceCredential } from '@/lib/field-session';
import { fieldSignInAction, unpairAction } from '../actions';
import { FieldFrame } from '../field-frame';

export default function FieldSignInPage() {
  return (
    <Suspense fallback={<FieldLoading />}>
      <FieldSignIn />
    </Suspense>
  );
}

async function FieldSignIn() {
  if (!(await getDeviceCredential())) redirect('/field/pair');
  const f = getMessages().field;
  return (
    <FieldFrame title={f.signInTitle}>
      <ActionForm action={fieldSignInAction} label={f.signIn} working={f.signingIn}>
        <Field name="phone" label={f.phone} type="tel" inputMode="tel" autoComplete="tel" required />
        <Field name="pin" label={f.pin} hint={f.pinHint} type="password" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} autoComplete="current-password" required />
      </ActionForm>
      <form action={unpairAction} className="mt-10">
        <button type="submit" className={secondaryButtonClass}>{f.unpair}</button>
      </form>
    </FieldFrame>
  );
}
