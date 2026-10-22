import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'node:crypto';

import { EnvironmentVariables } from '../config/environment';

@Injectable()
export class PasswordService {
  private dummyHash?: Promise<string>;

  constructor(
    private readonly config: ConfigService<EnvironmentVariables, true>,
  ) {}

  validate(password: string): void {
    if (
      typeof password !== 'string' ||
      Array.from(password).length < 12 ||
      Buffer.byteLength(password, 'utf8') > 72 ||
      password.trim().length === 0 ||
      password.includes('\0')
    ) {
      throw new BadRequestException(
        'Password must contain at least 12 characters and at most 72 UTF-8 bytes',
      );
    }
  }

  async hash(password: string): Promise<string> {
    this.validate(password);
    return bcrypt.hash(
      password,
      this.config.get('AUTH_BCRYPT_ROUNDS', { infer: true }),
    );
  }

  async verify(password: string, hash: string): Promise<boolean> {
    return bcrypt.compare(password, hash);
  }

  async verifyAgainstDummy(password: string): Promise<void> {
    this.dummyHash ??= bcrypt.hash(
      randomBytes(48).toString('base64url'),
      this.config.get('AUTH_BCRYPT_ROUNDS', { infer: true }),
    );
    await bcrypt.compare(password, await this.dummyHash);
  }
}
