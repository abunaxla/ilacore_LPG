import 'server-only';
import type { SmsDelivery } from '@/components/sms-delivery';

export type CustomerKind = 'retailer' | 'wholesaler';

export interface CustomerSummary {
  /** One shop, office only, number not checked yet. */
  checkSms?: SmsDelivery | null;
  id: string;
  kind: CustomerKind;
  name: string;
  area: string | null;
  labelCode: string;
  phoneVerified: boolean;
  /** Only sent to people who manage customers. */
  phone?: string;
  billedThrough: { id: string; name: string } | null;
  emptiesOwed: number;
}

export interface StandInMessage {
  id: string;
  to: string;
  customer: string;
  purpose: string;
  body: string;
  createdAt: string;
}

/** Shows +254712345678 as 0712 345 678. */
export const showPhone = (phone: string) =>
  phone.startsWith('+254') && phone.length === 13 ? `0${phone.slice(4, 7)} ${phone.slice(7, 10)} ${phone.slice(10)}` : phone;
