/**
 * Prints the before and after table from `evals/results/`, and with --write
 * puts it into the README between the eval-results markers.
 *
 *   pnpm evals:report
 *   pnpm evals:report --write
 */
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { briefExpansionSuite } from './brief-expansion.suite.js';
import type { RunRecord } from './harness.js';
import { moderatorSuite } from './moderator.suite.js';
import { renderReport, replaceBetweenMarkers, type ReportSuite } from './report.js';

const SUITES: ReportSuite[] = [
  { name: briefExpansionSuite.name, title: 'Brief expansion', scores: briefExpansionSuite.scores },
  { name: moderatorSuite.name, title: 'Moderator', scores: moderatorSuite.scores },
];

const RESULTS_DIR = new URL('./results/', import.meta.url);
const README = new URL('../../../README.md', import.meta.url);

const { values } = parseArgs({ options: { write: { type: 'boolean', default: false } } });

const files = (await readdir(RESULTS_DIR)).filter(
  (file) => file.endsWith('.json') && !file.endsWith('.partial.json'),
);
const records = await Promise.all(
  files.map(async (file) => JSON.parse(await readFile(new URL(file, RESULTS_DIR), 'utf8')) as RunRecord),
);

const report = renderReport(SUITES, records);
console.log(report);

if (values.write) {
  const readme = await readFile(README, 'utf8');
  await writeFile(README, replaceBetweenMarkers(readme, report));
  console.log('\nUpdated README.md');
}
