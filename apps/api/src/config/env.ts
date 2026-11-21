import { z } from 'zod';

/**
 * All configuration comes from the environment and is validated at start-up.
 * The API refuses to start with missing or invalid settings. Nothing is hard-coded.
 */
const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  /** Connection for the application: a login role that is a member of lpg_app, never a superuser. */
  DATABASE_URL: z.url(),
  /** Connection used only to run migrations (schema owner). */
  DATABASE_MIGRATION_URL: z.url().optional(),
  /** 32 random bytes, base64. Encrypts MFA secrets at rest. Generate with: openssl rand -base64 32 */
  MFA_ENCRYPTION_KEY: z
    .string()
    .refine((v) => Buffer.from(v, 'base64').length === 32, 'must be 32 bytes, base64-encoded'),
  /** Name shown in authenticator apps. */
  MFA_ISSUER: z.string().min(1).default('ILACORE'),
  /** Send the session cookie only over HTTPS. Defaults to on in production. */
  COOKIE_SECURE: z.enum(['true', 'false']).optional(),
  /** Where SMS go. 'stand_in' (default) keeps them on a test screen and sends nothing; tests always use it. */
  SMS_PROVIDER: z.enum(['stand_in', 'africastalking']).default('stand_in'),
  /** Africa's Talking app username ("sandbox" for their sandbox) and API key. Secrets: never commit real ones. */
  AT_USERNAME: z.string().min(1).optional(),
  AT_API_KEY: z.string().min(1).optional(),
  /** Approved sender ID (e.g. ILACORE). Leave unset to use Africa's Talking's shared sender. */
  AT_SENDER_ID: z.string().min(1).max(11).optional(),
}).superRefine((env, ctx) => {
  if (env.SMS_PROVIDER !== 'africastalking') return;
  for (const key of ['AT_USERNAME', 'AT_API_KEY'] as const) {
    if (!env[key]) ctx.addIssue({ code: 'custom', path: [key], message: 'required when SMS_PROVIDER=africastalking' });
  }
});

export type Env = z.infer<typeof EnvSchema>;

export function cookieSecure(env: Env): boolean {
  return env.COOKIE_SECURE ? env.COOKIE_SECURE === 'true' : env.NODE_ENV === 'production';
}

export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  const result = EnvSchema.safeParse(source);
  if (!result.success) {
    // Report which settings are wrong, never their values (they may be secrets).
    const problems = result.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`);
    throw new Error(`Invalid environment configuration: ${problems.join('; ')}`);
  }
  return result.data;
}
