import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import type { Pool } from 'pg';
import { Public } from '../access/decorators.js';
import { PG_POOL } from '../db/database.module.js';

@Public()
@Controller('health')
export class HealthController {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  /** Liveness and database reachability. Reveals no configuration or version details. */
  @Get()
  async check(): Promise<{ status: 'ok'; database: 'ok' }> {
    try {
      await this.pool.query('SELECT 1');
    } catch {
      throw new ServiceUnavailableException({ status: 'error', database: 'unreachable' });
    }
    return { status: 'ok', database: 'ok' };
  }
}
