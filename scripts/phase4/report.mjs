import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const artifacts = resolve(root, 'artifacts/phase4');
await mkdir(artifacts, { recursive: true });

const statusLines = (await readFile(resolve(artifacts, 'status.tsv'), 'utf8'))
  .split('\n')
  .filter(Boolean);
const reports = [];
for (const line of statusLines) {
  const [name, status, exitCode, reason] = line.split('\t');
  const report = {
    name,
    status,
    exitCode: Number(exitCode),
    reason: reason || undefined,
    log: `artifacts/phase4/${name}.log`,
  };
  const jestFile = resolve(artifacts, `${name}-jest.json`);
  const vitestFile = resolve(artifacts, 'web-vitest.json');
  const structuredFile = name === 'web-unit' ? vitestFile : jestFile;
  try {
    const structured = JSON.parse(await readFile(structuredFile, 'utf8'));
    Object.assign(report, {
      totalTests: structured.numTotalTests,
      passed: structured.numPassedTests,
      failed: structured.numFailedTests,
      skipped: structured.numPendingTests,
      totalSuites: structured.numTotalTestSuites,
      passedSuites: structured.numPassedTestSuites,
      failedSuites: structured.numFailedTestSuites,
    });
  } catch {
    if (name === 'web-money') {
      const output = await readFile(resolve(artifacts, `${name}.log`), 'utf8');
      report.totalTests = numberFrom(output, /^# tests (\d+)$/m);
      report.passed = numberFrom(output, /^# pass (\d+)$/m);
      report.failed = numberFrom(output, /^# fail (\d+)$/m);
      report.skipped = numberFrom(output, /^# skipped (\d+)$/m);
    }
    if (name === 'data-size') {
      const output = await readFile(resolve(artifacts, `${name}.log`), 'utf8');
      const json = output.split('\n').find((entry) => entry.startsWith('{'));
      if (json) report.rows = JSON.parse(json);
    }
  }
  await writeFile(
    resolve(artifacts, `${name}.json`),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  reports.push(report);
}

const environment = {
  capturedAt: new Date().toISOString(),
  node: process.version,
  npm: process.env.LEDGERFLOW_NPM_VERSION || 'unavailable',
  docker: process.env.LEDGERFLOW_DOCKER_VERSION || 'unavailable',
  compose: process.env.LEDGERFLOW_COMPOSE_VERSION || 'unavailable',
  platform: `${os.type()} ${os.release()} (${os.arch()})`,
  logicalCpus: os.cpus().length,
  memoryBytes: os.totalmem(),
  postgresImage: 'postgres:18-alpine',
  redisImage: 'redis:7.4-alpine',
  database: {
    endpoint: '127.0.0.1:55432',
    name: 'ledgerflow_phase1f_integration_phase4',
    state:
      'isolated Phase 4 Compose project; phase4:reset creates a fresh volume',
    syntheticDataset: ['test-ada', 'test-tobi'],
    externalCustomerData: false,
  },
  redis: {
    endpoint: '127.0.0.1:56379',
    persistence: 'disabled',
  },
  prisma: '7.10.1',
};
const dataSizeReport = reports.find((report) => report.name === 'data-size');
environment.database.intendedSyntheticSeed = ['test-ada', 'test-tobi'];
environment.database.dataSize = dataSizeReport?.rows ?? {
  status: 'unavailable',
  reason:
    'Database migrations/data-size query did not complete; see baseline blockers.',
};
delete environment.database.syntheticDataset;

const counts = {
  passedCommands: reports.filter((report) => report.status === 'passed').length,
  failedCommands: reports.filter((report) => report.status === 'failed').length,
  skippedCommands: reports.filter((report) => report.status === 'skipped')
    .length,
};
const summary = {
  phase: '4A',
  startedAt: process.env.LEDGERFLOW_BASELINE_STARTED_AT || null,
  completedAt: new Date().toISOString(),
  environment,
  counts,
  reports,
  disclaimer:
    'Command-level status does not imply every assertion passed unless test counts are present. Skipped and blocked work is not reported as passed.',
};
await writeFile(
  resolve(artifacts, 'environment.json'),
  `${JSON.stringify(environment, null, 2)}\n`,
);
await writeFile(
  resolve(artifacts, 'baseline.json'),
  `${JSON.stringify(summary, null, 2)}\n`,
);
process.exitCode = counts.failedCommands > 0 ? 1 : 0;

function numberFrom(value, pattern) {
  const match = value.match(pattern);
  return match ? Number(match[1]) : undefined;
}
