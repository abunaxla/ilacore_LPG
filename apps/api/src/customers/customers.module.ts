import { Module } from '@nestjs/common';
import { CustomersController } from './customers.controller.js';
import { CustomersService } from './customers.service.js';

/** Retailers and wholesalers, their verified number, and the SMS stand-in's test screen. */
@Module({
  controllers: [CustomersController],
  providers: [CustomersService],
})
export class CustomersModule {}
