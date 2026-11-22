import { getMessages } from '@/i18n';

/** What became of a code SMS, as the API reports it from the provider's delivery reports. */
export interface SmsDelivery {
  state: 'stand_in' | 'sent' | 'delivered' | 'not_delivered';
  reason: string | null;
  at: string | null;
}

/**
 * One line under a code: delivered, still on its way, or not delivered and why. Nothing for the stand-in (no real
 * SMS) or when there is no message. `href` reloads the page to see a report that arrived since.
 */
export function SmsDeliveryLine({ sms, href }: { sms: SmsDelivery | null | undefined; href: string }) {
  const s = getMessages().sms;
  if (!sms || sms.state === 'stand_in') return null;
  return (
    <p role="status" className={`mb-3 ${sms.state === 'not_delivered' ? 'rounded-md border-2 border-current p-3 font-semibold' : ''}`}>
      {sms.state === 'delivered' ? `✓ ${s.delivered}` : null}
      {sms.state === 'not_delivered' ? `⚠ ${s.notDelivered(s.reasons[sms.reason ?? ''] ?? sms.reason ?? '')}` : null}
      {sms.state === 'sent' ? (
        <>
          {s.sent}{' '}
          <a href={href} className="underline underline-offset-4">{s.checkAgain}</a>
        </>
      ) : null}
    </p>
  );
}
