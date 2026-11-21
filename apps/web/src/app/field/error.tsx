'use client';

import { buttonClass } from '@/components/fields';
import { getMessages } from '@/i18n';

/**
 * Shown when a handheld screen fails, which on a handheld nearly always means no signal for something that
 * needs it (sending the shop the code, entering the code, approvals). Those are never queued: the server
 * decides them when they happen, so custody only moves once the shop's code has really been checked.
 */
export default function FieldError() {
  const f = getMessages().field;
  return (
    <main id="main" tabIndex={-1} className="mx-auto w-full max-w-md flex-1 px-4 py-6">
      <p role="alert" className="mb-5 rounded-md border-2 border-current p-3 text-lg font-semibold">⚠ {f.needsSignal}</p>
      <button type="button" className={buttonClass} onClick={() => window.location.reload()}>
        {f.tryAgain}
      </button>
    </main>
  );
}
