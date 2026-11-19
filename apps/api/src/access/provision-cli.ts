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

/** Reads a line from the keyboard without showing it. Backspace works; Ctrl+C cancels. */
function readHidden(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    process.stdout.write(prompt);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    let value = '';
    const done = (error?: Error) => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener('data', onData);
      process.stdout.write('\n');
      if (error) reject(error);
      else resolve(value);
    };
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') return done();
        if (ch === '\u0003') return done(new Error('Cancelled'));
        if (ch === '\u0008' || ch === '\u007f') value = value.slice(0, -1);
        else if (ch >= ' ') value += ch;
      }
    };
    stdin.on('data', onData);
  });
}

async function readPassword(): Promise<string> {
  if (process.stdin.isTTY) return (await readHidden('Administrator password (12+ characters, not shown): ')).trim();
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