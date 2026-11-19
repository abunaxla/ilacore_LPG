'use client';

import { useFormStatus } from 'react-dom';
import { errorText } from '@/i18n';
import { buttonClass, secondaryButtonClass } from './fields';

export interface FormState {
  error?: string;
  message?: string;
}

/** Disabled while the form is sending, with the working label announced. */
export function SubmitButton({ label, working, secondary = false }: { label: string; working: string; secondary?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} aria-disabled={pending} className={secondary ? secondaryButtonClass : buttonClass}>
      {pending ? working : label}
    </button>
  );
}

/**
 * The result of the last submission, read out by screen readers. Errors carry a text marker as well as
 * a border, so they never rely on colour alone.
 */
export function FormMessage({ state }: { state: FormState }) {
  if (state.error) {
    return (
      <p role="alert" className="rounded-md border-2 border-current p-3 font-semibold">
        <span aria-hidden="true">⚠ </span>
        {errorText(state.error)}
      </p>
    );
  }
  if (state.message) {
    return (
      <p role="status" className="rounded-md border-2 border-dashed border-current p-3">
        <span aria-hidden="true">✓ </span>
        {state.message}
      </p>
    );
  }
  return <div aria-live="polite" />;
}