import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const document = JSON.parse(
  await readFile(resolve(root, 'apps/api/openapi.json'), 'utf8'),
);
const contractMap = JSON.parse(
  await readFile(resolve(root, 'apps/web/api-contract-map.json'), 'utf8'),
);
const methods = new Set([
  'get',
  'post',
  'put',
  'patch',
  'delete',
  'options',
  'head',
]);
const normalize = (method, path) => `${method.toUpperCase()} ${path}`;
const mapped = new Map();

for (const item of contractMap) {
  const key = normalize(item.method, item.path);
  assert.ok(!mapped.has(key), `duplicate contract entry: ${key}`);
  assert.ok(item.path.startsWith('/api/v1/'), `${key} is not versioned`);
  assert.ok(item.auth && item.notes, `${key} needs auth and contract notes`);
  if (item.client !== '—') {
    for (const source of item.client.split('; ')) {
      await readFile(resolve(root, source), 'utf8');
    }
  }
  mapped.set(key, item);
}

const documented = new Map();
for (const [path, pathItem] of Object.entries(document.paths ?? {})) {
  assert.ok(path.startsWith('/api/v1/'), `${path} is not versioned`);
  for (const [method, operation] of Object.entries(pathItem)) {
    if (!methods.has(method)) continue;
    const key = normalize(method, path);
    documented.set(key, operation);
  }
}

assert.deepEqual(
  [...mapped.keys()].sort(),
  [...documented.keys()].sort(),
  'frontend contract map must account for every actual Swagger operation and no speculative endpoints',
);

const operation = (method, path) => {
  const result = documented.get(normalize(method, path));
  assert.ok(result, `missing OpenAPI operation ${method} ${path}`);
  return result;
};
const hasResponses = (method, path, expected) => {
  const actual = Object.keys(operation(method, path).responses ?? {});
  for (const status of expected) {
    assert.ok(actual.includes(String(status)), `${method} ${path} must document ${status}; got ${actual.join(', ')}`);
  }
};

hasResponses('POST', '/api/v1/auth/register', [201, 400, 409, 429]);
hasResponses('POST', '/api/v1/auth/login', [200, 401, 403, 429]);
hasResponses('POST', '/api/v1/auth/refresh', [204, 401, 403, 429]);
hasResponses('POST', '/api/v1/transfers', [201, 400, 401, 403, 409, 429]);
hasResponses('GET', '/api/v1/wallets/{id}/transactions', [200, 400, 401, 403]);
hasResponses('GET', '/api/v1/audit-events/search', [200, 400, 401, 403]);

assert.ok(document.components?.securitySchemes?.['access-cookie']);
assert.ok(document.components?.securitySchemes?.['refresh-cookie']);
assert.ok(document.components?.securitySchemes?.['csrf-token']);
assert.ok(
  operation('POST', '/api/v1/transfers').parameters?.some(
    (parameter) => parameter.name.toLowerCase() === 'idempotency-key' && parameter.required,
  ),
  'transfer contract must require Idempotency-Key',
);
assert.ok(
  operation('POST', '/api/v1/transfers').security?.some((scheme) => 'csrf-token' in scheme),
  'transfer contract must declare CSRF security',
);

const flattened = JSON.stringify(document.components?.schemas ?? {});
assert.match(flattened, /"balanceMinor"\s*:\s*\{[^{}]*"type"\s*:\s*"string"/);
assert.match(flattened, /"amountMinor"\s*:\s*\{[^{}]*"type"\s*:\s*"string"/);
assert.match(flattened, /"pageSize"\s*:\s*\{[^{}]*"type"\s*:\s*"integer"/);

process.stdout.write(
  `PASS ${documented.size} versioned API operations match the frontend contract map; auth, CSRF, idempotency, error statuses, pagination, and minor-unit serialization are documented.\n`,
);
