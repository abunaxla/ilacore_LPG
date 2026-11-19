import { Body, Controller, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import { PIN_LENGTH } from '@ilacore/domain';
import type { Request } from 'express';
import { z } from 'zod';
import { requestMeta } from '../http/request.js';
import { parseBody } from '../http/validation.js';
import type { AuthContext } from '../identity/auth-context.js';
import { Auth, RequirePermission } from './decorators.js';
import { DevicesService } from './devices.service.js';
import { LOCATION_KINDS, LocationsService } from './locations.service.js';
import { UsersService } from './users.service.js';

const CreateUserBody = z.object({
  phone: z.string().min(9).max(20),
  displayName: z.string().min(1).max(120),
  password: z.string().min(1).max(200).optional(),
  pin: z.string().length(PIN_LENGTH).optional(),
});
const GrantRoleBody = z.object({ role: z.string().min(1).max(40), locationId: z.uuid().optional() });
const PinBody = z.object({ pin: z.string().length(PIN_LENGTH) });
const PasswordBody = z.object({ password: z.string().min(1).max(200) });
const StatusBody = z.object({ status: z.enum(['active', 'disabled']) });
const RegisterDeviceBody = z.object({
  name: z.string().min(1).max(120),
  kind: z.enum(['handheld', 'reader']),
  locationId: z.uuid().optional(),
});
const LocationBody = z.object({ name: z.string().min(1).max(120), kind: z.enum(LOCATION_KINDS) });

const uuid = new ParseUUIDPipe();

@Controller('users')
@RequirePermission('user.manage')
export class UsersController {
  constructor(@Inject(UsersService) private readonly users: UsersService) {}

  @Get()
  list(@Auth() ctx: AuthContext) {
    return this.users.list(ctx);
  }

  @Post()
  create(@Auth() ctx: AuthContext, @Req() req: Request, @Body() raw: unknown) {
    return this.users.create(ctx, parseBody(CreateUserBody, raw), requestMeta(req));
  }

  @Post(':id/roles')
  grant(@Auth() ctx: AuthContext, @Req() req: Request, @Param('id', uuid) id: string, @Body() raw: unknown) {
    return this.users.grantRole(ctx, id, parseBody(GrantRoleBody, raw), requestMeta(req));
  }

  @Post(':id/roles/:assignmentId/revoke')
  @HttpCode(204)
  async revoke(
    @Auth() ctx: AuthContext,
    @Req() req: Request,
    @Param('id', uuid) id: string,
    @Param('assignmentId', uuid) assignmentId: string,
  ) {
    await this.users.revokeRole(ctx, id, assignmentId, requestMeta(req));
  }

  @Post(':id/pin')
  @HttpCode(204)
  async pin(@Auth() ctx: AuthContext, @Req() req: Request, @Param('id', uuid) id: string, @Body() raw: unknown) {
    await this.users.setPin(ctx, id, parseBody(PinBody, raw).pin, requestMeta(req));
  }

  @Post(':id/password')
  @HttpCode(204)
  async password(@Auth() ctx: AuthContext, @Req() req: Request, @Param('id', uuid) id: string, @Body() raw: unknown) {
    await this.users.resetPassword(ctx, id, parseBody(PasswordBody, raw).password, requestMeta(req));
  }

  @Post(':id/mfa/reset')
  @HttpCode(204)
  async resetMfa(@Auth() ctx: AuthContext, @Req() req: Request, @Param('id', uuid) id: string) {
    await this.users.resetMfa(ctx, id, requestMeta(req));
  }

  @Post(':id/status')
  @HttpCode(204)
  async status(@Auth() ctx: AuthContext, @Req() req: Request, @Param('id', uuid) id: string, @Body() raw: unknown) {
    await this.users.setStatus(ctx, id, parseBody(StatusBody, raw).status, requestMeta(req));
  }
}

@Controller('devices')
@RequirePermission('device.manage')
export class DevicesController {
  constructor(@Inject(DevicesService) private readonly devices: DevicesService) {}

  @Get()
  list(@Auth() ctx: AuthContext) {
    return this.devices.list(ctx);
  }

  @Post()
  register(@Auth() ctx: AuthContext, @Req() req: Request, @Body() raw: unknown) {
    return this.devices.register(ctx, parseBody(RegisterDeviceBody, raw), requestMeta(req));
  }

  @Post(':id/revoke')
  @HttpCode(204)
  async revoke(@Auth() ctx: AuthContext, @Req() req: Request, @Param('id', uuid) id: string) {
    await this.devices.revoke(ctx, id, requestMeta(req));
  }
}

@Controller('locations')
export class LocationsController {
  constructor(@Inject(LocationsService) private readonly locations: LocationsService) {}

  @Get()
  @RequirePermission(['settings.manage', 'user.manage', 'device.manage'])
  list(@Auth() ctx: AuthContext) {
    return this.locations.list(ctx);
  }

  @Post()
  @RequirePermission('settings.manage')
  create(@Auth() ctx: AuthContext, @Req() req: Request, @Body() raw: unknown) {
    return this.locations.create(ctx, parseBody(LocationBody, raw), requestMeta(req));
  }
}