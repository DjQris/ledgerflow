import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';

import { EnvironmentVariables } from '../config/environment';
import { HealthService } from './health.service';

describe('HealthService', () => {
  let service: HealthService;

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
});
