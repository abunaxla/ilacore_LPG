import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react';

/** Shared look for inputs: large, high-contrast, a visible label above, the hint tied to the input. */
export const inputClass =
  'block w-full rounded-md border-2 border-current bg-transparent px-3 py-2 text-lg disabled:opacity-60';
export const buttonClass =
  'inline-flex items-center justify-center rounded-md border-2 border-current bg-foreground px-5 py-2 text-lg font-semibold text-background disabled:opacity-60';
export const secondaryButtonClass =
  'inline-flex items-center justify-center rounded-md border-2 border-current px-4 py-2 text-base font-semibold disabled:opacity-60';

interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  name: string;
  label: string;
  hint?: string;
}

export function Field({ name, label, hint, id, ...input }: FieldProps) {
  const inputId = id ?? `field-${name}`;
  const hintId = hint ? `${inputId}-hint` : undefined;
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={inputId} className="font-semibold">
        {label}
      </label>
      {hint ? (
        <p id={hintId} className="text-base">
          {hint}
        </p>
      ) : null}
      <input id={inputId} name={name} aria-describedby={hintId} className={inputClass} {...input} />
    </div>
  );
}

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  name: string;
  label: string;
  children: ReactNode;
}

export function Select({ name, label, id, children, ...select }: SelectProps) {
  const selectId = id ?? `select-${name}`;
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={selectId} className="font-semibold">
        {label}
      </label>
      <select id={selectId} name={name} className={inputClass} {...select}>
        {children}
      </select>
    </div>
  );
}