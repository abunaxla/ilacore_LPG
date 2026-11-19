'use client';

import { useActionState } from 'react';
import { Field } from '@/components/fields';
import { FormMessage, SubmitButton, type FormState } from '@/components/form-bits';
import { getMessages } from '@/i18n';
import { changePasswordAction } from '../sign-in/actions';

export function ChangePasswordForm() {
  const t = getMessages().password;
  const [state, action] = useActionState<FormState, FormData>(changePasswordAction, {});
  return (
    <form action={action} className="flex flex-col gap-5">
      <FormMessage state={state} />
      <Field name="current" label={t.current} required type="password" autoComplete="current-password" />
      <Field name="next" label={t.next} hint={t.nextHint} required type="password" autoComplete="new-password" minLength={12} />
      <SubmitButton label={t.submit} working={t.working} />
    </form>
  );
}