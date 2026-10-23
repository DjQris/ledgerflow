import { AddressInfo } from 'node:net';
import { Server } from 'node:http';

import {
  closeBackgroundHealthServer,
  startBackgroundHealthServer,
} from './health-server';

describe('background process health server', () => {
  let server: Server | undefined;

  afterEach(async () => {
    if (server) await closeBackgroundHealthServer(server);
    server = undefined;
  });

  it('binds locally and separates liveness from dependency readiness', async () => {
    let ready = true;
    server = await startBackgroundHealthServer({
      role: 'worker',
      port: 0,
      isReady: () => Promise.resolve(ready),
    });
    expect((server.address() as AddressInfo).address).toBe('127.0.0.1');
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const live = await fetch(`${base}/live`);
    expect(live.status).toBe(200);
    expect(await live.json()).toEqual({ role: 'worker', status: 'ok' });
    ready = false;
    const unavailable = await fetch(`${base}/ready`);
    expect(unavailable.status).toBe(503);
    expect(await unavailable.json()).toEqual({
      role: 'worker',
      status: 'unready',
    });
    expect((await fetch(`${base}/missing`)).status).toBe(404);
  });

  it('turns a probe exception into a redacted unready response', async () => {
    server = await startBackgroundHealthServer({
      role: 'dispatcher',
      port: 0,
      isReady: () => {
        throw new Error('private connection detail');
      },
    });
    const port = (server.address() as AddressInfo).port;
    const response = await fetch(`http://127.0.0.1:${port}/ready`);
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain('private connection detail');
  });
});
