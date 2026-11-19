/**
 * Creates an organisation and its first administrator.
 *
 *   corepack pnpm provision --name "Acme Gas Ltd" --code acme-gas --phone 0712345678 --admin "Jane Wanjiru"
 *
 * The password is read from standard input so it never appears in the command line or shell history.
 * Uses DATABASE_MIGRATION_URL (the schema owner).
 */
import { createInterface } from 'node:readline';
import { parseArgs } from 'node:util';
import { Pool } from 'pg';
import { provisionOrganisation } from './provisioning.js';

async function readPassword(): Promise<string> {
  if (process.stdin.isTTY) process.stdout.write('Administrator password (12+ characters): ');
  const rl = createInterface({ input: process.stdin, terminal: false });
  for await (const line of rl) {
    rl.close();
    return line.trim();
  }
  throw new Error('No password given on standard input');
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      name: { type: 'string' },
      code: { type: 'string' },
      phone: { type: 'string' },
      admin: { type: 'string' },
    },
  });
  if (!values.name || !values.code || !values.phone || !values.admin) {
    throw new Error('Usage: provision --name <organisation> --code <sign-in code> --phone <admin phone> --admin <admin name>');
  }
  const url = process.env['DATABASE_MIGRATION_URL'];
  if (!url) throw new Error('DATABASE_MIGRATION_URL is not set');

  const password = await readPassword();
  const pool = new Pool({ connectionString: url, max: 1 });
  try {
    const result = await provisionOrganisation(pool, {
      organisationName: values.name,
      slug: values.code,
      admin: { phone: values.phone, displayName: values.admin, password },
    });
    console.log(`Created organisation "${values.code}" (${result.tenantId}) and its administrator.`);
    console.log('Sign in with the organisation code, phone and password; you will be asked to set up MFA.');
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error((error as Error).message);
  process.exitCode = 1;
});