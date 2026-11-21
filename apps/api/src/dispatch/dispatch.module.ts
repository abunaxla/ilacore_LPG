import { Module } from '@nestjs/common';
import { HandoversController } from '../handovers/handovers.controller.js';
import { SmsService } from '../customers/sms.js';
import { HandoversService } from '../handovers/handovers.service.js';
import { TripsController } from './trips.controller.js';
import { TripsService } from './trips.service.js';

/** Dispatch: trips out of a depot (load, approve, driver signs), handovers to customers, and returns back in. */
@Module({
  controllers: [TripsController, HandoversController],
  providers: [TripsService, HandoversService, SmsService],
})
export class DispatchModule {}
