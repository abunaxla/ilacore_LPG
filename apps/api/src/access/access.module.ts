import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { AuthController } from '../identity/auth.controller.js';
import { AuthService, SECRET_BOX } from '../identity/auth.service.js';
import { SecretBox } from '../identity/secret-box.js';
import { SessionService } from '../identity/session.service.js';
import { AccessGuard } from './access.guard.js';
import { DevicesController, LocationsController, UsersController } from './admin.controllers.js';
import { DevicesService } from './devices.service.js';
import { LocationsService } from './locations.service.js';
import { UsersService } from './users.service.js';

/** Identity (sign-in, MFA, sessions, devices) and access (roles, permissions, the global guard). */
@Module({
  controllers: [AuthController, UsersController, DevicesController, LocationsController],
  providers: [
    SessionService,
    AuthService,
    UsersService,
    DevicesService,
    LocationsService,
    { provide: SECRET_BOX, inject: [ENV], useFactory: (env: Env) => new SecretBox(env.MFA_ENCRYPTION_KEY) },
    { provide: APP_GUARD, useClass: AccessGuard },
  ],
})
export class AccessModule {}