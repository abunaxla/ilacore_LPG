'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { buttonClass, Field } from '@/components/fields';
import { FormMessage, SubmitButton } from '@/components/form-bits';
import { getMessages } from '@/i18n';
import {
  confirmMfaSetupAction,
  startMfaSetupAction,
  type MfaConfirmState,
  type MfaStartState,
} from '../actions';

export function MfaSetup() {
  const t = getMessages().mfaSetup;
  // Two separate action states, so the secret held by the first is never sent back with the second.
  const [started, start] = useActionState<MfaStartState>(startMfaSetupAction, {});
  const [confirmed, confirm] = useActionState<MfaConfirmState, FormData>(confirmMfaSetupAction, {});

  if (confirmed.recoveryCodes) {
    return (
      <section aria-labelledby="codes-title" className="flex flex-col gap-4">
        <h2 id="codes-title" className="text-2xl font-bold">{t.codesTitle}</h2>
        <p>{t.codesIntro}</p>
        <ol className="grid grid-cols-1 gap-2 rounded-md border-2 border-current p-4 font-mono text-lg sm:grid-cols-2">
          {confirmed.recoveryCodes.map((code) => <li key={code}>{code}</li>)}
        </ol>
        <Link href="/" className={buttonClass}>{t.codesDone}</Link>
      </section>
    );
  }

  if (!started.secret) {
    return (
      <form action={start} className="flex flex-col gap-5">
        <FormMessage state={started} />
        <p>{t.intro}</p>
        <SubmitButton label={t.start} working={t.starting} />
      </form>
    );
  }

  return (
    <form action={confirm} className="flex flex-col gap-5">
      <FormMessage state={confirmed} />
      <p>{t.scan}</p>
      {/* eslint-disable-next-line @next/next/no-img-element -- a data URL generated on the server, nothing to optimise */}
      <img src={started.qr} alt={t.qrLabel} width={240} height={240} className="rounded-md bg-white p-2" />
      <p>{t.manual}</p>
      <p className="break-all rounded-md border-2 border-current p-3 font-mono text-lg">{started.secret}</p>
      <Field name="code" label={t.confirm} required inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,7}" maxLength={7} />
      <SubmitButton label={t.confirmSubmit} working={t.confirming} />
    </form>
  );
}
