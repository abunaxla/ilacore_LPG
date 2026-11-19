'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { buttonClass, Field } from '@/components/fields';
import { FormMessage, SubmitButton } from '@/components/form-bits';
import { getMessages } from '@/i18n';
import { mfaSetupAction, type MfaSetupState } from '../actions';

export function MfaSetup() {
  const t = getMessages().mfaSetup;
  const [state, action] = useActionState<MfaSetupState, FormData>(mfaSetupAction, { phase: 'start' });

  if (state.phase === 'codes') {
    return (
      <section aria-labelledby="codes-title" className="flex flex-col gap-4">
        <h2 id="codes-title" className="text-2xl font-bold">{t.codesTitle}</h2>
        <p>{t.codesIntro}</p>
        <ol className="grid grid-cols-1 gap-2 rounded-md border-2 border-current p-4 font-mono text-lg sm:grid-cols-2">
          {state.recoveryCodes?.map((code) => <li key={code}>{code}</li>)}
        </ol>
        <Link href="/" className={buttonClass}>{t.codesDone}</Link>
      </section>
    );
  }

  return (
    <form action={action} className="flex flex-col gap-5">
      <FormMessage state={state} />
      {state.phase === 'start' ? (
        <>
          <p>{getMessages().mfaSetup.intro}</p>
          <input type="hidden" name="step" value="start" />
          <SubmitButton label={t.start} working={t.starting} />
        </>
      ) : (
        <>
          <p>{t.scan}</p>
          {/* eslint-disable-next-line @next/next/no-img-element -- a data URL generated on the server, nothing to optimise */}
          <img src={state.qr} alt={t.qrLabel} width={240} height={240} className="rounded-md bg-white p-2" />
          <p>{t.manual}</p>
          <p className="break-all rounded-md border-2 border-current p-3 font-mono text-lg">{state.secret}</p>
          <input type="hidden" name="step" value="confirm" />
          <Field name="code" label={t.confirm} required inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,7}" maxLength={7} />
          <SubmitButton label={t.confirmSubmit} working={t.confirming} />
        </>
      )}
    </form>
  );
}