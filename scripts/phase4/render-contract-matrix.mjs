import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const map = JSON.parse(
  await readFile(resolve(root, 'apps/web/api-contract-map.json'), 'utf8'),
);
const escape = (value) => String(value).replaceAll('|', '\\|').replaceAll('\n', ' ');
const rows = map
  .map(
    (item) =>
      `| ${item.method} | \`${item.path}\` | ${escape(item.client)} | ${escape(item.bff)} | ${escape(item.auth)} | ${escape(item.notes)} |`,
  )
  .join('\n');
const markdown = `# Phase 4B — API/client contract matrix

Generated from the backend OpenAPI document produced by Nest Swagger decorators and the checked-in frontend mapping at \`apps/web/api-contract-map.json\`. The API's Swagger annotations are authoritative; do not add speculative paths here. Regenerate with \`npm run phase4:openapi\` followed by \`node scripts/phase4/render-contract-matrix.mjs\`.

| Method | Versioned API path | Frontend client source | Same-origin browser BFF | Auth / write protection | Contract notes |
| --- | --- | --- | --- | --- | --- |
${rows}
`;
await writeFile(resolve(root, 'docs/phase4/api-contract-matrix.md'), markdown);
process.stdout.write(`Rendered ${map.length} API/client operations.\n`);
