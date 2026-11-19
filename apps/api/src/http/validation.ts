import { BadRequestException } from '@nestjs/common';
import type { z } from 'zod';

/** Validates a request body. Reports which fields are wrong, never their values. */
export function parseBody<S extends z.ZodType>(schema: S, body: unknown): z.infer<S> {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new BadRequestException({
      error: 'invalid_request',
      fields: result.error.issues.map((i) => i.path.join('.') || '(body)'),
    });
  }
  return result.data;
}