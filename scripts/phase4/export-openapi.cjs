const { randomBytes } = require('node:crypto');
const { mkdir, writeFile } = require('node:fs/promises');
const { resolve } = require('node:path');

async function main() {
  // Create the Nest module only to read route/decorator metadata. Do not call
  // app.init() or listen(): this exporter must never connect to a database.
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL =
    'postgresql://notused:notused@127.0.0.1:55432/ledgerflow_phase1f_integration_phase4?schema=public';
  process.env.REDIS_URL = 'redis://127.0.0.1:56379';
  process.env.AUTH_SIGNING_KEY = randomBytes(48).toString('hex');
  process.env.AUTH_ALLOWED_ORIGIN = 'http://127.0.0.1:43101';
  process.env.PORT = '43000';

  const { NestFactory } = require('@nestjs/core');
  const { SwaggerModule } = require('@nestjs/swagger');
  const { AppModule } = require('../../apps/api/dist/app.module.js');
  const { buildSwaggerConfig } = require('../../apps/api/dist/swagger-config.js');

  const app = await NestFactory.create(AppModule, { logger: false });
  try {
    app.setGlobalPrefix('api/v1');
    const document = SwaggerModule.createDocument(app, buildSwaggerConfig());
    const target = resolve(__dirname, '../../apps/api/openapi.json');
    await mkdir(resolve(target, '..'), { recursive: true });
    await writeFile(target, `${JSON.stringify(document, null, 2)}\n`);
    process.stdout.write(`Generated ${target} from Nest Swagger metadata.\n`);
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : 'OpenAPI export failed'}\n`,
  );
  process.exitCode = 1;
});
