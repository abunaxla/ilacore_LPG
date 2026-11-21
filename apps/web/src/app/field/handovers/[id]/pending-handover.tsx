'use client';

import { useEffect, useRef, useState } from 'react';
import { getMessages } from '@/i18n';
import { CHANGED, listOps, type Op } from '@/lib/field-outbox';
import { ScanForm } from './scan-form';

/**
 * A handover started on this handheld that the server has not had yet (no signal). The driver can scan; once the
 * start has been sent, the real handover screen takes over. The id comes from the page, or from the address
 * (#id) when the service worker shows this with no signal.
 */
export function PendingHandover({ id }: { id?: string }) {
  const f = getMessages().field;
  const [handoverId, setHandoverId] = useState(id);
  const [start, setStart] = useState<Op | null | undefined>(undefined);
  const seenWaiting = useRef(false);

  useEffect(() => {
    const hid = id ?? (window.location.hash.slice(1) || undefined);
    const update = async () => {
      const ops = hid ? (await listOps()).filter((o) => o.handoverId === hid) : [];
      const op = ops.find((o) => o.kind === 'start') ?? null;
      setHandoverId(hid);
      setStart(op);
      if (op && !op.failed) seenWaiting.current = true;
      // Everything for this handover has been sent while this screen was open: load the real handover screen.
      // Not before, so leaving the page never cuts a scan off mid-send. A full load on purpose, so the server
      // (or, with no signal, the service worker) decides what is shown.
      const stillToSend = ops.some((o) => !o.failed);
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      if (!op && !stillToSend && seenWaiting.current) window.location.assign(`/field/handovers/${hid}`);
    };
    void update();
    window.addEventListener(CHANGED, update);
    return () => window.removeEventListener(CHANGED, update);
  }, [id]);

  if (start === undefined) return null;
  if (!handoverId || !start || start.kind !== 'start') return <p role="alert">{f.pendingUnknown}</p>;
  return (
    <>
      <p className="mb-2 text-xl font-semibold">{start.shopName}</p>
      <p className="mb-5">{f.pendingIntro}</p>
      {start.failed ? null : <ScanForm handoverId={handoverId} refreshOnSend={false} />}
    </>
  );
}
