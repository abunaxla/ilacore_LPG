import { Module } from '@nestjs/common';
import { CustomersController } from './customers.controller.js';
import { CustomersService } from './customers.service.js';
import { SmsService } from './sms.js';

/** Retailers and wholesalers, their verified number, and the SMS stand-in's test screen. */
@Module({
  controllers: [CustomersController],
  providers: [CustomersService, SmsService],
})
export class CustomersModule {}
