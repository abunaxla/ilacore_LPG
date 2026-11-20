import { Body, Controller, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import { PHYSICAL_STATES, SAFETY_STATES, SCAN_PURPOSES, TAG_RETIRE_REASONS, type Permission } from '@ilacore/domain';
import type { Request } from 'express';
import { z } from 'zod';
import { Auth, RequirePermission } from '../access/decorators.js';
import { requestMeta } from '../http/request.js';
import { parseBody } from '../http/validation.js';
import type { AuthContext } from '../identity/auth-context.js';
import { CylindersService, MAX_CYLINDERS_PER_IMPORT } from './cylinders.service.js';
import { ScansService } from './scans.service.js';
import { SizesService } from './sizes.service.js';

const uuid = new ParseUUIDPipe();
const VIEW: Permission[] = ['item.view_position', 'item.register'];
const SCAN: Permission[] = ['item.register', 'dispatch.scan', 'stocktake.perform', 'audit.perform'];

const bodyLocation = (req: Request) =>
  typeof (req.body as { locationId?: unknown } | undefined)?.locationId === 'string'
    ? (req.body as { locationId: string }).locationId
    : undefined;
const queryLocation = (req: Request) => (typeof req.query.locationId === 'string' ? req.query.locationId : undefined);

const date = z.string().max(10).optional();
const Cylinder = z.object({
  sizeId: z.string().max(40),
  epc: z.string().min(1).max(80),
  serial: z.string().max(60).optional(),
  manufacturer: z.string().max(120).optional(),
  manufacturedOn: date,
  tareKg: z.number().optional(),
  physicalState: z.enum(['empty', 'full']).optional(),
});
const RegisterBody = Cylinder.extend({ locationId: z.uuid() });
const ImportBody = z.object({ locationId: z.uuid(), cylinders: z.array(Cylinder).min(1).max(MAX_CYLINDERS_PER_IMPORT) });
const ListQuery = z.object({
  locationId: z.uuid().optional(),
  sizeId: z.uuid().optional(),
  physicalState: z.enum(PHYSICAL_STATES).optional(),
  safety: z.enum(SAFETY_STATES).optional(),
  search: z.string().max(60).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
});
const ReplaceTagBody = z.object({ epc: z.string().min(1).max(80), reason: z.enum(TAG_RETIRE_REASONS) });
const SizeBody = z.object({ name: z.string().min(1).max(30), nominalFillKg: z.number() });
const OpenSessionBody = z.object({ purpose: z.enum(SCAN_PURPOSES), locationId: z.uuid(), note: z.string().max(200).optional() });
const ReadsBody = z.object({
  batchId: z.uuid(),
  reads: z
    .array(
      z.object({
        epc: z.string().min(1).max(80),
        rssi: z.number().nullable().optional(),
        antenna: z.number().int().nullable().optional(),
        readAt: z.string().max(40),
      }),
    )
    .max(500),
});

/** Cylinder sizes. Everyone who works with cylinders can read them; the owner changes them. */
@Controller('cylinder-settings')
export class CylinderSettingsController {
  constructor(@Inject(SizesService) private readonly sizes: SizesService) {}

  @Get()
  @RequirePermission(['settings.manage', ...VIEW], { anyLocation: true })
  get(@Auth() ctx: AuthContext) {
    return this.sizes.settings(ctx);
  }

  @Post('sizes')
  @RequirePermission('settings.manage')
  addSize(@Auth() ctx: AuthContext, @Req() req: Request, @Body() raw: unknown) {
    return this.sizes.addSize(ctx, parseBody(SizeBody, raw), requestMeta(req));
  }

  @Post('sizes/:id/retire')
  @HttpCode(204)
  @RequirePermission('settings.manage')
  async retireSize(@Auth() ctx: AuthContext, @Req() req: Request, @Param('id', uuid) id: string) {
    await this.sizes.retireSize(ctx, id, requestMeta(req));
  }
}

@Controller('cylinders')
export class CylindersController {
  constructor(@Inject(CylindersService) private readonly cylinders: CylindersService) {}

  /** With ?locationId the permission is needed there; without it, organisation-wide. */
  @Get()
  @RequirePermission(VIEW, { location: queryLocation })
  list(@Auth() ctx: AuthContext, @Query() query: unknown) {
    return this.cylinders.list(ctx, parseBody(ListQuery, query));
  }

  @Post()
  @RequirePermission('item.register', { location: bodyLocation })
  async register(@Auth() ctx: AuthContext, @Req() req: Request, @Body() raw: unknown) {
    const { locationId, ...cylinder } = parseBody(RegisterBody, raw);
    const { ids } = await this.cylinders.register(ctx, locationId, [cylinder], requestMeta(req));
    return { id: ids[0] };
  }

  /** All or nothing: every row is checked and every problem reported before anything is saved. */
  @Post('import')
  @RequirePermission('item.register', { location: bodyLocation })
  import(@Auth() ctx: AuthContext, @Req() req: Request, @Body() raw: unknown) {
    const body = parseBody(ImportBody, raw);
    return this.cylinders.register(ctx, body.locationId, body.cylinders, requestMeta(req));
  }

  @Get('by-tag/:epc')
  @RequirePermission(VIEW, { anyLocation: true })
  byTag(@Auth() ctx: AuthContext, @Param('epc') epc: string) {
    return this.cylinders.byTag(ctx, epc);
  }

  @Get(':id')
  @RequirePermission(VIEW, { anyLocation: true })
  get(@Auth() ctx: AuthContext, @Param('id', uuid) id: string) {
    return this.cylinders.get(ctx, id);
  }

  @Post(':id/tag')
  @RequirePermission('item.replace_tag', { anyLocation: true })
  replaceTag(@Auth() ctx: AuthContext, @Param('id', uuid) id: string, @Body() raw: unknown) {
    return this.cylinders.replaceTag(ctx, id, parseBody(ReplaceTagBody, raw));
  }
}

/** Scan sessions. The permission depends on the purpose and the place, so the service checks it. */
@Controller('scan-sessions')
export class ScanSessionsController {
  constructor(@Inject(ScansService) private readonly scans: ScansService) {}

  @Get()
  @RequirePermission([...SCAN, ...VIEW], { anyLocation: true })
  list(@Auth() ctx: AuthContext) {
    return this.scans.list(ctx);
  }

  @Post()
  @RequirePermission(SCAN, { anyLocation: true })
  open(@Auth() ctx: AuthContext, @Req() req: Request, @Body() raw: unknown) {
    return this.scans.open(ctx, parseBody(OpenSessionBody, raw), requestMeta(req));
  }

  @Get(':id')
  @RequirePermission([...SCAN, ...VIEW], { anyLocation: true })
  get(@Auth() ctx: AuthContext, @Param('id', uuid) id: string) {
    return this.scans.get(ctx, id);
  }

  @Post(':id/reads')
  @HttpCode(200)
  @RequirePermission(SCAN, { anyLocation: true })
  reads(@Auth() ctx: AuthContext, @Param('id', uuid) id: string, @Body() raw: unknown) {
    return this.scans.addReads(ctx, id, parseBody(ReadsBody, raw));
  }

  @Post(':id/close')
  @HttpCode(204)
  @RequirePermission(SCAN, { anyLocation: true })
  async close(@Auth() ctx: AuthContext, @Req() req: Request, @Param('id', uuid) id: string) {
    await this.scans.close(ctx, id, requestMeta(req));
  }
}
