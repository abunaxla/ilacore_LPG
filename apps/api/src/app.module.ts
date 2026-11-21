import { Module } from '@nestjs/common';
import { AccessModule } from './access/access.module.js';
import { ConfigModule } from './config/config.module.js';
import { DatabaseModule } from './db/database.module.js';
import { HealthController } from './health/health.controller.js';
import { CustomersModule } from './customers/customers.module.js';
import { DispatchModule } from './dispatch/dispatch.module.js';
import { ItemsModule } from './items/items.module.js';

/**
 * Root module. Business modules (tracked-items, custody, ledger...) are added here
 * as they are built; see apps/api/README.md for the planned list.
 */
@Module({
  imports: [ConfigModule, DatabaseModule, AccessModule, ItemsModule, DispatchModule, CustomersModule],
  controllers: [HealthController],
})
export class AppModule {}