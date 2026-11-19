'use client';

import { useActionState, type ReactNode } from 'react';
import { FormMessage, SubmitButton, type FormState } from './form-bits';

/** A small form bound to one Server Action, with its own result message. */
export function ActionForm({
  action,
  label,
  working,
  children,
  secondary = false,
  className = 'flex flex-col gap-4',
}: {
  action: (prev: FormState, fd: FormData) => Promise<FormState>;
  label: string;
  working: string;
  children?: ReactNode;
  secondary?: boolean;
  className?: string;
}) {
  const [state, run] = useActionState<FormState, FormData>(action, {});
  return (
    <form action={run} className={className}>
      <FormMessage state={state} />
      {children}
      <div>
        <SubmitButton label={label} working={working} secondary={secondary} />
      </div>
    </form>
  );
}