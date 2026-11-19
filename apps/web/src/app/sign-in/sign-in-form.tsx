'use client';

import { useActionState } from 'react';
import { Field } from '@/components/fields';
import { FormMessage, SubmitButton, type FormState } from '@/components/form-bits';
import { getMessages } from '@/i18n';
import { signInAction } from './actions';

export function SignInForm() {
  const t = getMessages().signIn;
  const [state, action] = useActionState<FormState, FormData>(signInAction, {});
  return (
    <form action={action} className="flex flex-col gap-5">
      <FormMessage state={state} />
      <Field name="organisation" label={t.organisation} hint={t.organisationHint} required autoComplete="organization" autoCapitalize="none" spellCheck={false} />
      <Field name="phone" label={t.phone} hint={t.phoneHint} required type="tel" inputMode="tel" autoComplete="username" />
      <Field name="password" label={t.password} required type="password" autoComplete="current-password" />
      <SubmitButton label={t.submit} working={t.working} />
    </form>
  );
}