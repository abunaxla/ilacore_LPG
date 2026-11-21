import type { ReactNode } from 'react';
import { secondaryButtonClass } from '@/components/fields';
import { getMessages } from '@/i18n';
import { fieldSignOutAction } from './actions';
import { Connection, ForgetPagesOnSubmit } from './connection';

/** Header and a narrow column for the handheld screens: large text and targets, one thing at a time. */
export function FieldFrame({ name, title, children }: { name?: string; title: string; children: ReactNode }) {
  const f = getMessages().field;
  return (
    <>
      <header className="border-b-2 border-current">
        <div className="mx-auto flex w-full max-w-md flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
          <span className="flex-1 text-lg font-bold tracking-wide">{f.appName}</span>
          {name ? (
            <>
              <span className="text-base">{name}</span>
              <form action={fieldSignOutAction} data-sign-out>
                <button type="submit" className={secondaryButtonClass}>{f.signOut}</button>
              </form>
            </>
          ) : null}
        </div>
      </header>
      <main id="main" tabIndex={-1} className="mx-auto w-full max-w-md flex-1 px-4 py-6">
        <Connection />
        <ForgetPagesOnSubmit />
        <h1 className="mb-5 text-2xl font-bold">{title}</h1>
        {children}
      </main>
    </>
  );
}
