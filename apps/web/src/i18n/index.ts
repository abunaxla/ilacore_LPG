import { en, type ErrorCode, type Messages } from './messages.en';

/** The active catalogue. Only English exists today; selection by user preference comes later. */
export function getMessages(): Messages {
  return en;
}

/** Plain-language text for an API error code. */
export function errorText(code: string | undefined): string {
  const errors = getMessages().errors;
  return code && code in errors ? errors[code as ErrorCode] : errors.unknown;
}