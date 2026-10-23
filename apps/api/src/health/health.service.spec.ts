import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';

import { EnvironmentVariables } from '../config/environment';
import { HealthService } from './health.service';
import { PrismaService } from '../prisma/prisma.service';

describe('HealthService', () => {
  let service: HealthService;
  const query = jest.fn();

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HealthService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockReturnValue('ledgerflow-api'),
          } satisfies Partial<ConfigService<EnvironmentVariables, true>>,
        },
        { provide: PrismaService, useValue: { $queryRaw: query } },
      ],
    }).compile();

    service = module.get(HealthService);
  });

  it('returns service health with an ISO timestamp', () => {
    const response = service.getHealth();

    expect(response.service).toBe('ledgerflow-api');
    expect(response.status).toBe('ok');
    expect(new Date(response.timestamp).toISOString()).toBe(response.timestamp);
  });

  it('reports database readiness without leaking connection errors', async () => {
    query.mockResolvedValueOnce([{ '?column?': 1 }]);
    expect((await service.getReadiness()).status).toBe('ok');
    query.mockRejectedValueOnce(
      new Error('private database connection detail'),
    );
    expect(await service.getReadiness()).toMatchObject({
      service: 'ledgerflow-api',
      status: 'unready',
    });
  });
});
