import { HttpException, HttpStatus } from '@nestjs/common';

/** API errors carry a stable code for the client and a plain-language message. */
export function apiError(status: HttpStatus, error: string, message: string, extra: Record<string, unknown> = {}): HttpException {
  return new HttpException({ error, message, ...extra }, status);
}

/** The same answer for unknown accounts, wrong secrets, disabled and locked accounts. */
export const invalidCredentials = () =>
  apiError(
    HttpStatus.UNAUTHORIZED,
    'invalid_credentials',
    'Those details are not right, or there were too many attempts. Check them, or wait 15 minutes.',
  );
