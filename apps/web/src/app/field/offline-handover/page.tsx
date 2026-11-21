import { getMessages } from '@/i18n';
import { FieldFrame } from '../field-frame';
import { PendingHandover } from '../handovers/[id]/pending-handover';

/**
 * Kept on the handheld by the service worker (public/field-sw.js) and shown, as /field/offline-handover#<id>,
 * for a handover started with no signal. Static: everything it shows comes from the handheld's outbox.
 */
export default function OfflineHandoverPage() {
  return (
    <FieldFrame title={getMessages().field.pendingTitle}>
      <PendingHandover />
    </FieldFrame>
  );
}
