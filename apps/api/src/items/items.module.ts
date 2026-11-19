import { Module } from '@nestjs/common';
import { CylindersService } from './cylinders.service.js';
import { CylinderSettingsController, CylindersController, ScanSessionsController } from './items.controllers.js';
import { ScansService } from './scans.service.js';
import { SizesService } from './sizes.service.js';

/** Tracked items (cylinders first), their tags, cylinder sizes and scan sessions. */
@Module({
  controllers: [CylinderSettingsController, CylindersController, ScanSessionsController],
  providers: [SizesService, CylindersService, ScansService],
})
export class ItemsModule {}
