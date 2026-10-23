import { createServer, Server } from 'node:http';

export interface BackgroundHealthOptions {
  role: 'dispatcher' | 'worker';
  port: number;
  isReady: () => Promise<boolean>;
}

async function readyWithinLimit(
  check: () => Promise<boolean>,
): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve()
        .then(check)
        .catch(() => false),
      new Promise<false>((resolve) => {
        timer = setTimeout(() => resolve(false), 2_000);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function startBackgroundHealthServer(
  options: BackgroundHealthOptions,
): Promise<Server> {
  const server = createServer((request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    if (
      request.method !== 'GET' ||
      !['/live', '/ready'].includes(request.url ?? '')
    ) {
      response.writeHead(404).end(JSON.stringify({ status: 'not_found' }));
      return;
    }
    if (request.url === '/live') {
      response
        .writeHead(200)
        .end(JSON.stringify({ role: options.role, status: 'ok' }));
      return;
    }
    void readyWithinLimit(options.isReady).then((ready) => {
      response.writeHead(ready ? 200 : 503).end(
        JSON.stringify({
          role: options.role,
          status: ready ? 'ok' : 'unready',
        }),
      );
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port, '127.0.0.1', () => {
      server.removeListener('error', reject);
      resolve();
    });
  });
  return server;
}

export async function closeBackgroundHealthServer(
  server: Server,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}
