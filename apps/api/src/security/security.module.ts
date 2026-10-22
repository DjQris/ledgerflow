import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';

import { AuditModule } from '../audit/audit.module';
import { CookieService } from './cookie.service';
import { CsrfService } from './csrf.service';
import { PasswordService } from './password.service';
import { SessionService } from './session.service';
import { TokenService } from './token.service';

@Module({
  imports: [AuditModule, JwtModule.register({})],
  providers: [
    CookieService,
    CsrfService,
    PasswordService,
    SessionService,
    TokenService,
  ],
  exports: [
    CookieService,
    CsrfService,
    PasswordService,
    SessionService,
    TokenService,
  ],
})
export class SecurityModule {}
