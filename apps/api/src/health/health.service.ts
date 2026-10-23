import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { EnvironmentVariables } from '../config/environment';
import { PrismaService } from '../prisma/prisma.service';

export interface HealthResponse {
  service: string;
  status: 'ok' | 'unready';
  timestamp: string;
}

@Injectable()
export class HealthService {
  constructor(
    private readonly configService: ConfigService<EnvironmentVariables, true>,
    private readonly prisma: PrismaService,
  ) {}

  getHealth(): HealthResponse {
    return {
      service: this.configService.get('SERVICE_NAME', { infer: true }),
      status: 'ok',
      timestamp: new Date().toISOString(),
    };
  }

  async getReadiness(): Promise<HealthResponse> {
    let status: HealthResponse['status'] = 'ok';
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        this.prisma.$queryRaw`SELECT 1`,
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error('Readiness timeout')),
            2_000,
          );
        }),
      ]);
    } catch {
      status = 'unready';
    } finally {
      if (timer) clearTimeout(timer);
    }
    return { ...this.getHealth(), status };
  }
}
