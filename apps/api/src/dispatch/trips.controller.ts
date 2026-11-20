import { Body, Controller, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import type { Permission } from '@ilacore/domain';
import type { Request } from 'express';
import { z } from 'zod';
import { Auth, RequirePermission } from '../access/decorators.js';
import { requestMeta } from '../http/request.js';
import { parseBody } from '../http/validation.js';
import type { AuthContext } from '../identity/auth-context.js';
import { MAX_TAGS_PER_CALL, TripsService } from './trips.service.js';

const uuid = new ParseUUIDPipe();
/** Anyone who works with a depot's trips, and drivers (who see only their own; the service filters). */
const VIEW: Permission[] = ['dispatch.scan', 'dispatch.approve_exception', 'route.settle', 'item.view_position', 'handover.perform'];

const bodyDepot = (req: Request) =>
  typeof (req.body as { depotId?: unknown } | undefined)?.depotId === 'string' ? (req.body as { depotId: string }).depotId : undefined;
const queryDepot = (req: Request) => (typeof req.query.depotId === 'string' ? req.query.depotId : undefined);

const OpenBody = z.object({
  depotId: z.uuid(),
  driverId: z.uuid(),
  vehicleReg: z.string().min(1).max(20),
  note: z.string().max(400).optional(),
});
const Tags = z.array(z.string().max(80)).min(1).max(MAX_TAGS_PER_CALL);
const LoadBody = z.object({ epcs: Tags });
const ReturnBody = z.object({ epcs: Tags, physicalState: z.enum(['empty', 'full']) });
const ListQuery = z.object({
  depotId: z.uuid().optional(),
  status: z.enum(['loading', 'out', 'cancelled']).optional(),
});

/**
 * Trips. Loading and returns are the loader's (dispatch.scan), approvals the supervisor's
 * (dispatch.approve_exception), signing the driver's. Each is checked at the trip's depot by the service.
 */
@Controller('trips')
export class TripsController {
  constructor(@Inject(TripsService) private readonly trips: TripsService) {}

  @Get('drivers')
  @RequirePermission('dispatch.scan', { location: queryDepot })
  drivers(@Auth() ctx: AuthContext, @Query('depotId', uuid) depotId: string) {
    return this.trips.drivers(ctx, depotId);
  }

  @Get()
  @RequirePermission(VIEW, { anyLocation: true })
  list(@Auth() ctx: AuthContext, @Query() raw: unknown) {
    return this.trips.list(ctx, parseBody(ListQuery, raw));
  }

  @Post()
  @RequirePermission('dispatch.scan', { location: bodyDepot })
  open(@Auth() ctx: AuthContext, @Req() req: Request, @Body() raw: unknown) {
    return this.trips.open(ctx, parseBody(OpenBody, raw), requestMeta(req));
  }

  @Get(':id')
  @RequirePermission(VIEW, { anyLocation: true })
  get(@Auth() ctx: AuthContext, @Param('id', uuid) id: string) {
    return this.trips.get(ctx, id);
  }

  @Post(':id/load')
  @HttpCode(200)
  @RequirePermission('dispatch.scan', { anyLocation: true })
  load(@Auth() ctx: AuthContext, @Param('id', uuid) id: string, @Body() raw: unknown) {
    return this.trips.addToLoad(ctx, id, parseBody(LoadBody, raw).epcs);
  }

  @Post(':id/lines/:itemId/remove')
  @HttpCode(204)
  @RequirePermission('dispatch.scan', { anyLocation: true })
  async remove(@Auth() ctx: AuthContext, @Param('id', uuid) id: string, @Param('itemId', uuid) itemId: string) {
    await this.trips.removeFromLoad(ctx, id, itemId);
  }

  @Post(':id/lines/:itemId/approve')
  @HttpCode(204)
  @RequirePermission('dispatch.approve_exception', { anyLocation: true })
  async approve(@Auth() ctx: AuthContext, @Req() req: Request, @Param('id', uuid) id: string, @Param('itemId', uuid) itemId: string) {
    await this.trips.approve(ctx, id, itemId, requestMeta(req));
  }

  @Post(':id/sign')
  @HttpCode(200)
  @RequirePermission('handover.perform', { anyLocation: true })
  sign(@Auth() ctx: AuthContext, @Req() req: Request, @Param('id', uuid) id: string) {
    return this.trips.sign(ctx, id, requestMeta(req));
  }

  @Post(':id/cancel')
  @HttpCode(204)
  @RequirePermission(['dispatch.scan', 'dispatch.approve_exception'], { anyLocation: true })
  async cancel(@Auth() ctx: AuthContext, @Req() req: Request, @Param('id', uuid) id: string) {
    await this.trips.cancel(ctx, id, requestMeta(req));
  }

  @Post(':id/return')
  @HttpCode(200)
  @RequirePermission('dispatch.scan', { anyLocation: true })
  returnToDepot(@Auth() ctx: AuthContext, @Param('id', uuid) id: string, @Body() raw: unknown) {
    const body = parseBody(ReturnBody, raw);
    return this.trips.returnToDepot(ctx, id, body.epcs, body.physicalState);
  }
}
