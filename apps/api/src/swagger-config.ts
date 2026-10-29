import { DocumentBuilder } from '@nestjs/swagger';

export function buildSwaggerConfig() {
  return new DocumentBuilder()
    .setTitle('LedgerFlow API')
    .setDescription('LedgerFlow backend API documentation')
    .setVersion('1.0')
    .addTag('health')
    .addTag('wallets')
    .addTag('transfers')
    .addTag('audit')
    .addTag('operations')
    .addTag('auth')
    .addCookieAuth(
      'ledgerflow_access',
      {
        description: 'HTTP-only access cookie (production uses __Host- prefix)',
        in: 'cookie',
        name: 'ledgerflow_access',
        type: 'apiKey',
      },
      'access-cookie',
    )
    .addCookieAuth(
      'ledgerflow_refresh',
      {
        description:
          'HTTP-only refresh cookie (production uses __Host- prefix)',
        in: 'cookie',
        name: 'ledgerflow_refresh',
        type: 'apiKey',
      },
      'refresh-cookie',
    )
    .addApiKey(
      {
        type: 'apiKey',
        in: 'header',
        name: 'X-CSRF-Token',
        description:
          'Session-bound token from login, refresh, or GET /auth/csrf',
      },
      'csrf-token',
    )
    .build();
}
