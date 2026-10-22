import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
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
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';

import { Public } from '../access-control/decorators/public.decorator';
import { Roles } from '../access-control/decorators/roles.decorator';
import { PermissionPolicies } from '../access-control/permission-policies';
import { CookieService } from '../security/cookie.service';
import { AuthService } from './auth.service';
import type { AuthenticatedUser } from './auth.types';
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
  ) {}

  @Post('register')
  @Public()
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
  @Public()
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
    return result.profile;
  }

  @Post('refresh')
  @Public()
  @UseGuards(AuthOriginGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Rotate a refresh token and renew access' })
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
    } catch (error: unknown) {
      this.cookies.clear(response);
      throw error;
    }
  }

  @Post('logout')
  @Public()
  @UseGuards(AuthOriginGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Revoke the active session and clear cookies' })
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
}
