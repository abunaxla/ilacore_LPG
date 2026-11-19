import { Module } from '@nestjs/common';
import { ConfigModule } from './config/config.module.js';
import { DatabaseModule } from './db/database.module.js';
import { HealthController } from './health/health.controller.js';

/**
 * Root module. Business modules (access, tracked-items, custody, ledger...) are added here
 * as they are built; see apps/api/README.md for the planned list.
 */
@Module({
  imports: [ConfigModule, DatabaseModule],
  controllers: [HealthController],
})
export class AppModule {}
