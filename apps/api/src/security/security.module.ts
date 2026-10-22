import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';

import { AuditModule } from '../audit/audit.module';
import { CookieService } from './cookie.service';
import { PasswordService } from './password.service';
import { SessionService } from './session.service';
import { TokenService } from './token.service';

@Module({
  imports: [AuditModule, JwtModule.register({})],
  providers: [CookieService, PasswordService, SessionService, TokenService],
  exports: [CookieService, PasswordService, SessionService, TokenService],
})
export class SecurityModule {}
