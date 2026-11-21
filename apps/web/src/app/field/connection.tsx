'use client';

import { useEffect, useRef, useState } from 'react';
import { secondaryButtonClass } from '@/components/fields';
import { errorText, getMessages } from '@/i18n';
import { CHANGED, dismiss, listOps, markOffline, sync, syncState, type Op, type SyncState } from '@/lib/field-outbox';

/**
 * On every handheld screen: makes the screens open with no signal (the service worker, in production builds),
 * keeps sending what the outbox holds, and says plainly what is waiting and what could not be sent.
 */
export function Connection() {
  const f = getMessages().field;
  const [ops, setOps] = useState<Op[]>([]);
  const [state, setState] = useState<SyncState>('idle');
  const [blocked, setBlocked] = useState(false);
  const [justSent, setJustSent] = useState(false);
  const lastWaiting = useRef(0);
  const sentTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (process.env.NODE_ENV === 'production' && 'serviceWorker' in navigator) {
      navigator.serviceWorker.register('/field-sw.js', { scope: '/field' }).catch(() => undefined);
    }
    const update = () => {
      setState(syncState());
      if (syncState() !== 'offline') setBlocked(false);
      void listOps().then((list) => {
        // The outbox has just emptied: say so briefly, so the driver knows it all went.
        const waiting = list.filter((o) => !o.failed).length;
        if (lastWaiting.current > 0 && waiting === 0) {
          setJustSent(true);
          window.clearTimeout(sentTimer.current);
          sentTimer.current = window.setTimeout(() => setJustSent(false), 4000);
        }
        lastWaiting.current = waiting;
        setOps(list);
      });
    };
    // Anything that needs the server (sending the code, entering it, approvals…) is stopped with a plain message
    // when there is known to be no signal, instead of hanging. Forms that work without signal say so.
    const guard = (e: SubmitEvent) => {
      const form = e.target as HTMLFormElement;
      if (syncState() !== 'offline' || form.closest('[data-offline-ok]')) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      setBlocked(true);
      void sync().then(update);
    };
    const wentOffline = () => markOffline();
    // navigator.onLine is often wrong (it says online with no data), so sending is simply retried.
    const send = () => void sync().then(update);
    window.addEventListener(CHANGED, update);
    window.addEventListener('online', send);
    window.addEventListener('offline', wentOffline);
    window.addEventListener('submit', guard, true);
    document.addEventListener('visibilitychange', send);
    const timer = window.setInterval(send, 15_000);
    send();
    return () => {
      window.removeEventListener(CHANGED, update);
      window.removeEventListener('online', send);
      window.removeEventListener('offline', wentOffline);
      window.removeEventListener('submit', guard, true);
      document.removeEventListener('visibilitychange', send);
      window.clearInterval(timer);
      window.clearTimeout(sentTimer.current);
    };
  }, []);

  const waiting = ops.filter((o) => !o.failed);
  const failed = ops.filter((o) => o.failed);
  if (state !== 'offline' && state !== 'signin' && waiting.length === 0 && failed.length === 0 && !justSent) return null;

  const describe = (o: Op) => (o.kind === 'start' ? f.opStart(o.shopName) : f.opScan(o.direction, o.epcs.length));
  return (
    <div className="mb-5 flex flex-col gap-3">
      {blocked ? (
        <p role="alert" className="rounded-md border-2 border-current p-3 text-lg font-semibold">⚠ {f.needsSignal}</p>
      ) : null}
      {state === 'offline' || state === 'signin' || waiting.length > 0 ? (
        <div role="status" className="rounded-md border-2 border-dashed border-current p-3">
          {state === 'offline' ? <p className="font-semibold">⚠ {f.offline}</p> : null}
          {state === 'signin' ? <p className="font-semibold">⚠ {f.signInToSend}</p> : null}
          {waiting.length > 0 ? <p>{state === 'sending' ? f.sendingLeft(waiting.length) : f.waiting(waiting.length)}</p> : null}
        </div>
      ) : justSent ? (
        <p role="status" className="rounded-md border-2 border-current p-3 font-semibold">{f.allSent}</p>
      ) : null}
      {failed.length > 0 ? (
        <div role="alert" className="rounded-md border-2 border-current p-3">
          <p className="mb-2 font-semibold">⚠ {f.notSent}</p>
          <ul className="flex flex-col gap-2">
            {failed.map((o) => (
              <li key={o.seq} className="flex flex-wrap items-center gap-2">
                <span className="flex-1">
                  {describe(o)}: {errorText(o.failed)}
                </span>
                <button type="button" className={secondaryButtonClass} onClick={() => void dismiss(o.seq!)}>
                  {f.dismiss}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

/** Tells the service worker to forget the copies of this driver's pages (on sign-out). */
export function ForgetPagesOnSubmit() {
  useEffect(() => {
    const forms = document.querySelectorAll<HTMLFormElement>('form[data-sign-out]');
    const forget = () => navigator.serviceWorker?.controller?.postMessage('forget-pages');
    forms.forEach((form) => form.addEventListener('submit', forget));
    return () => forms.forEach((form) => form.removeEventListener('submit', forget));
  }, []);
  return null;
}
