import { Module } from '@nestjs/common';

import { UsersModule } from '../users/users.module';

// Phase 2A reserves the module boundary; no authentication is active yet.
@Module({ imports: [UsersModule] })
export class AuthModule {}
