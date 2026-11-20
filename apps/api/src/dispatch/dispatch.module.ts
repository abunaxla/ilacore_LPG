import { Module } from '@nestjs/common';
import { TripsController } from './trips.controller.js';
import { TripsService } from './trips.service.js';

/** Dispatch: trips out of a depot (load, approve, driver signs) and returns back in. */
@Module({
  controllers: [TripsController],
  providers: [TripsService],
})
export class DispatchModule {}
