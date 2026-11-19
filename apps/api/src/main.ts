import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';
import { ENV } from './config/config.module.js';
import type { Env } from './config/env.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: false });
  app.disable('x-powered-by');
  app.enableShutdownHooks();

  const env = app.get<Env>(ENV);
  await app.listen(env.PORT);
  console.log(`ILACORE API listening on port ${env.PORT}`);
}

bootstrap().catch((error: unknown) => {
  console.error((error as Error).message);
  process.exitCode = 1;
});
