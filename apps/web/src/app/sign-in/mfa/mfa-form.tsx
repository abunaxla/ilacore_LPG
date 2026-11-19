'use client';

import { useActionState } from 'react';
import { Field } from '@/components/fields';
import { FormMessage, SubmitButton, type FormState } from '@/components/form-bits';
import { getMessages } from '@/i18n';
import { verifyMfaAction } from '../actions';

export function MfaForm() {
  const t = getMessages().mfa;
  const [state, action] = useActionState<FormState, FormData>(verifyMfaAction, {});
  const [recoveryState, recoveryAction] = useActionState<FormState, FormData>(verifyMfaAction, {});
  return (
    <div className="flex flex-col gap-8">
      <form action={action} className="flex flex-col gap-5">
        <FormMessage state={state} />
        <Field
          name="code"
          label={t.code}
          required
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9 ]{6,7}"
          maxLength={7}
          autoFocus
        />
        <SubmitButton label={t.submit} working={t.working} />
      </form>
      <details className="rounded-md border-2 border-current p-4">
        <summary className="cursor-pointer font-semibold">{t.useRecovery}</summary>
        <form action={recoveryAction} className="mt-4 flex flex-col gap-5">
          <FormMessage state={recoveryState} />
          <Field name="recoveryCode" label={t.recoveryCode} hint={t.recoveryHint} required autoComplete="off" autoCapitalize="characters" spellCheck={false} />
          <SubmitButton label={t.submitRecovery} working={t.working} secondary />
        </form>
      </details>
    </div>
  );
}