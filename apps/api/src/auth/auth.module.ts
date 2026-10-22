import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module';
import { SecurityModule } from '../security/security.module';
import { UsersModule } from '../users/users.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AuthOriginGuard } from './guards/auth-origin.guard';
import { AuthenticationGuard } from './guards/authentication.guard';

@Module({
  imports: [AuditModule, SecurityModule, UsersModule],
  controllers: [AuthController],
  providers: [AuthService, AuthOriginGuard, AuthenticationGuard],
})
export class AuthModule {}
