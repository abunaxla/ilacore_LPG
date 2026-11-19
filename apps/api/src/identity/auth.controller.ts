import { Body, Controller, Get, HttpCode, Inject, Post, Req, Res } from '@nestjs/common';
import { permissionsOf, PIN_LENGTH } from '@ilacore/domain';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { ENV } from '../config/config.module.js';
import { cookieSecure, type Env } from '../config/env.js';
import { RateLimiter } from '../http/rate-limiter.js';
import { requestMeta, SESSION_COOKIE } from '../http/request.js';
import { parseBody } from '../http/validation.js';
import { AllowIncompleteSignIn, Auth, Public, SignedIn } from '../access/decorators.js';
import { nextStep, type AuthContext } from './auth-context.js';
import { AuthService } from './auth.service.js';

const SignInBody = z.object({
  organisation: z.string().min(1).max(40),
  phone: z.string().min(9).max(20),
  password: z.string().min(1).max(200),
});
const DeviceSignInBody = z.object({
  phone: z.string().min(9).max(20),
  pin: z.string().length(PIN_LENGTH),
});
const MfaCodeBody = z.object({ code: z.string().regex(/^\d{6}$/) });
const MfaVerifyBody = z
  .object({ code: z.string().regex(/^\d{6}$/).optional(), recoveryCode: z.string().min(16).max(24).optional() })
  .refine((b) => (b.code === undefined) !== (b.recoveryCode === undefined), 'send a code or a recovery code');
const ChangePasswordBody = z.object({ current: z.string().min(1).max(200), next: z.string().min(1).max(200) });

const MINUTE = 60_000;

@Controller('auth')
export class AuthController {
  // Per address: generous enough for a depot behind one shared connection.
  private readonly perIp = new RateLimiter(30, MINUTE);
  // Per account: on top of the database lockout.
  private readonly perPhone = new RateLimiter(10, 15 * MINUTE);
  private readonly perUser = new RateLimiter(10, 5 * MINUTE);

  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Public()
  @Post('sign-in')
  @HttpCode(200)
  async signIn(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    this.perIp.hit(`ip:${req.ip}`);
    const body = parseBody(SignInBody, req.body);
    this.perPhone.hit(`phone:${body.organisation}:${body.phone.replace(/\D/g, '').slice(-9)}`);
    const result = await this.auth.signInWeb(body, requestMeta(req));
    res.cookie(SESSION_COOKIE, result.token, {
      httpOnly: true,
      sameSite: 'strict',
      secure: cookieSecure(this.env),
      path: '/',
      expires: result.expiresAt,
    });
    return { next: result.next, displayName: result.displayName, expiresAt: result.expiresAt };
  }

  /** Handhelds send their device credential as `Authorization: Device <credential>` and get a bearer token. */
  @Public()
  @Post('device/sign-in')
  @HttpCode(200)
  async deviceSignIn(@Req() req: Request) {
    this.perIp.hit(`ip:${req.ip}`);
    const body = parseBody(DeviceSignInBody, req.body);
    const header = req.get('authorization');
    const credential = header?.startsWith('Device ') ? header.slice(7).trim() : undefined;
    this.perPhone.hit(`device:${credential?.split('.')[1] ?? 'none'}:${body.phone.replace(/\D/g, '').slice(-9)}`);
    const result = await this.auth.signInDevice({ credential, ...body }, requestMeta(req));
    return { token: result.token, expiresAt: result.expiresAt, displayName: result.displayName };
  }

  @SignedIn()
  @AllowIncompleteSignIn()
  @Get('me')
  me(@Auth() ctx: AuthContext) {
    return {
      displayName: ctx.displayName,
      phone: ctx.phone,
      channel: ctx.channel,
      roles: ctx.assignments,
      permissions: [...permissionsOf(ctx.assignments)].sort(),
      next: nextStep(ctx),
    };
  }

  @SignedIn()
  @AllowIncompleteSignIn()
  @Post('mfa/setup')
  @HttpCode(200)
  mfaSetup(@Auth() ctx: AuthContext) {
    return this.auth.beginMfaSetup(ctx);
  }

  @SignedIn()
  @AllowIncompleteSignIn()
  @Post('mfa/confirm')
  @HttpCode(200)
  mfaConfirm(@Auth() ctx: AuthContext, @Req() req: Request, @Body() raw: unknown) {
    this.perUser.hit(`mfa:${ctx.userId}`);
    const body = parseBody(MfaCodeBody, raw);
    return this.auth.confirmMfaSetup(ctx, body.code, requestMeta(req));
  }

  @SignedIn()
  @AllowIncompleteSignIn()
  @Post('mfa/verify')
  @HttpCode(204)
  async mfaVerify(@Auth() ctx: AuthContext, @Req() req: Request, @Body() raw: unknown) {
    this.perUser.hit(`mfa:${ctx.userId}`);
    const body = parseBody(MfaVerifyBody, raw);
    await this.auth.verifyMfa(ctx, body, requestMeta(req));
  }

  @SignedIn()
  @AllowIncompleteSignIn()
  @Post('password')
  @HttpCode(204)
  async changePassword(@Auth() ctx: AuthContext, @Req() req: Request, @Body() raw: unknown) {
    this.perUser.hit(`password:${ctx.userId}`);
    await this.auth.changePassword(ctx, parseBody(ChangePasswordBody, raw), requestMeta(req));
  }

  @SignedIn()
  @AllowIncompleteSignIn()
  @Post('sign-out')
  @HttpCode(204)
  async signOut(@Auth() ctx: AuthContext, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.auth.signOut(ctx, requestMeta(req));
    res.clearCookie(SESSION_COOKIE, { path: '/' });
  }
}