import type { NestExpressApplication } from '@nestjs/platform-express';
import { securityHeaders } from './security-headers.js';

/** Settings shared by the real server and the integration tests. */
export function configureApp(app: NestExpressApplication): void {
  app.disable('x-powered-by');
  // Caddy on the same machine terminates TLS; trust it (and only it) for the client address.
  app.set('trust proxy', 'loopback');
  app.use(securityHeaders);
  // Big enough for a 500-cylinder import or a 500-read batch (each well under 200 kB), small enough to stay cheap.
  app.useBodyParser('json', { limit: '512kb' });
  app.enableShutdownHooks();
}