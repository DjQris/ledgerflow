import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiSecurity,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { Throttle } from '@nestjs/throttler';

import { Public } from '../access-control/decorators/public.decorator';
import { Roles } from '../access-control/decorators/roles.decorator';
import { PermissionPolicies } from '../access-control/permission-policies';
import { CookieService } from '../security/cookie.service';
import { CsrfMode } from '../security/csrf-mode.decorator';
import { CsrfService } from '../security/csrf.service';
import { SessionService } from '../security/session.service';
import { AuthService } from './auth.service';
import type { AuthenticatedUser } from './auth.types';
import type { AuthenticatedRequest } from './guards/authentication.guard';
import { CurrentUser } from './decorators/current-user.decorator';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { UserProfileDto } from './dto/user-profile.dto';
import { AuthOriginGuard } from './guards/auth-origin.guard';
import { AuthenticationGuard } from './guards/authentication.guard';

@ApiTags('auth')
@ApiServiceUnavailableResponse({
  description: 'The signing key has not been configured.',
})
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly cookies: CookieService,
    private readonly csrf: CsrfService,
    private readonly sessions: SessionService,
  ) {}

  @Post('register')
  // Requests arrive from the shared Next.js BFF address. Keep this ceiling
  // aligned with the global API limit; the account bucket remains 10/5 min.
  @Throttle({ ip: { limit: 600, ttl: 60_000 } })
  @Public()
  @CsrfMode('exempt')
  @UseGuards(AuthOriginGuard)
  @ApiOperation({ summary: 'Register a customer account' })
  @ApiCreatedResponse({ type: UserProfileDto })
  @ApiBadRequestResponse({ description: 'Invalid email or password.' })
  @ApiConflictResponse({ description: 'Account already exists.' })
  @ApiForbiddenResponse({ description: 'Request origin is not allowed.' })
  register(@Body() input: RegisterDto): Promise<UserProfileDto> {
    return this.auth.register(input);
  }

  @Post('login')
  @Throttle({ ip: { limit: 600, ttl: 60_000 } })
  @Public()
  @CsrfMode('exempt')
  @UseGuards(AuthOriginGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Create a session and set HTTP-only cookies' })
  @ApiOkResponse({ type: UserProfileDto })
  @ApiUnauthorizedResponse({ description: 'Invalid credentials.' })
  @ApiForbiddenResponse({ description: 'Request origin is not allowed.' })
  async login(
    @Body() input: LoginDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<UserProfileDto> {
    const result = await this.auth.login(input);
    this.cookies.set(response, result.tokens);
    response.setHeader(
      'X-CSRF-Token',
      this.csrf.issueForAccess(result.tokens.accessToken),
    );
    return result.profile;
  }

  @Post('refresh')
  @Throttle({ ip: { limit: 60, ttl: 60_000 } })
  @Public()
  @CsrfMode('refresh')
  @UseGuards(AuthOriginGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Rotate a refresh token and renew access' })
  @ApiSecurity('csrf-token')
  @ApiNoContentResponse({ description: 'Fresh HTTP-only cookies set.' })
  @ApiUnauthorizedResponse({ description: 'Invalid or reused refresh token.' })
  @ApiForbiddenResponse({ description: 'Request origin is not allowed.' })
  async refresh(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    try {
      const tokens = await this.auth.refresh(this.cookies.readRefresh(request));
      this.cookies.set(response, tokens);
      response.setHeader(
        'X-CSRF-Token',
        this.csrf.issueForAccess(tokens.accessToken),
      );
    } catch (error: unknown) {
      this.cookies.clear(response);
      throw error;
    }
  }

  @Post('logout')
  @Public()
  @CsrfMode('logout')
  @UseGuards(AuthOriginGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Revoke the active session and clear cookies' })
  @ApiSecurity('csrf-token')
  @ApiNoContentResponse()
  @ApiForbiddenResponse({ description: 'Request origin is not allowed.' })
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    try {
      await this.auth.logout(
        this.cookies.readAccess(request),
        this.cookies.readRefresh(request),
      );
    } finally {
      this.cookies.clear(response);
    }
  }

  @Get('me')
  @Roles(...PermissionPolicies.identityRead)
  @UseGuards(AuthenticationGuard)
  @ApiCookieAuth('access-cookie')
  @ApiOperation({ summary: 'Read the current authenticated customer profile' })
  @ApiOkResponse({ type: UserProfileDto })
  @ApiUnauthorizedResponse({ description: 'No active session.' })
  me(@CurrentUser() user: AuthenticatedUser): UserProfileDto {
    return UserProfileDto.fromUser(user);
  }

  @Get('csrf')
  @Header('Cache-Control', 'no-store')
  @Roles(...PermissionPolicies.identityRead)
  @ApiCookieAuth('access-cookie')
  @ApiOperation({ summary: 'Get a session-bound CSRF token' })
  csrfToken(@Req() request: AuthenticatedRequest): { csrfToken: string } {
    return { csrfToken: this.csrf.issue(request.authenticatedSessionId!) };
  }

  @Get('refresh-csrf')
  @Header('Cache-Control', 'no-store')
  @Throttle({ ip: { limit: 60, ttl: 60_000 } })
  @Public()
  @ApiCookieAuth('refresh-cookie')
  @ApiOperation({ summary: 'Get a CSRF token for an active refresh session' })
  @ApiOkResponse({ description: 'Session-bound CSRF token.' })
  @ApiUnauthorizedResponse({ description: 'No active refresh session.' })
  async refreshCsrf(@Req() request: Request): Promise<{ csrfToken: string }> {
    const sessionId = await this.sessions.findActiveRefreshSessionId(
      this.cookies.readRefresh(request),
    );
    if (!sessionId) throw new UnauthorizedException('Authentication required');
    return { csrfToken: this.csrf.issue(sessionId) };
  }
}
