import { z } from 'zod';

/**
 * All configuration comes from the environment and is validated at start-up.
 * The API refuses to start with missing or invalid settings. Nothing is hard-coded.
 */
const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  /** Connection for the application: a login role that is a member of ilacore_app, never a superuser. */
  DATABASE_URL: z.url(),
  /** Connection used only to run migrations (schema owner). */
  DATABASE_MIGRATION_URL: z.url().optional(),
});

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  const result = EnvSchema.safeParse(source);
  if (!result.success) {
    // Report which settings are wrong, never their values (they may be secrets).
    const problems = result.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`);
    throw new Error(`Invalid environment configuration: ${problems.join('; ')}`);
  }
  return result.data;
}
