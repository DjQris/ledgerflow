import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { EnvironmentVariables } from '../config/environment';

export interface HealthResponse {
  service: string;
  status: 'ok';
  timestamp: string;
}

@Injectable()
export class HealthService {
  constructor(
    private readonly configService: ConfigService<EnvironmentVariables, true>,
  ) {}

  getHealth(): HealthResponse {
    return {
      service: this.configService.get('SERVICE_NAME', { infer: true }),
      status: 'ok',
      timestamp: new Date().toISOString(),
    };
  }
}
