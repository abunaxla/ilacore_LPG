import { en, type Messages } from './messages.en';

/** The active catalogue. Only English exists today; selection by user preference comes later. */
export function getMessages(): Messages {
  return en;
}
