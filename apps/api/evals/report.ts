import type { RunRecord, ScoreInfo } from './harness.js';

export interface ReportSuite {
  name: string;
  title: string;
  scores: ScoreInfo[];
}

const percent = (value: number) => `${Math.round(value * 100)}%`;

function change(before: number | undefined, after: number | undefined, format: (n: number) => string) {
  if (before === undefined || after === undefined) return '';
  const delta = after - before;
  return delta === 0 ? '0' : `${delta > 0 ? '+' : '-'}${format(Math.abs(delta))}`;
}

/**
 * The before and after table for each suite: every score as a percentage of
 * the items it applies to, then the task's latency and output tokens per
 * item, for v1, v2 and the change between them.
 */
export function renderReport(suites: ReportSuite[], records: RunRecord[]): string {
  const sections: string[] = [];

  for (const suite of suites) {
    const v1 = records.find((r) => r.suite === suite.name && r.variant === 'v1');
    const v2 = records.find((r) => r.suite === suite.name && r.variant === 'v2');
    if (!v1 && !v2) continue;

    const runs = [v1, v2].filter((r): r is RunRecord => Boolean(r));
    const sources = runs.map((r) => `${r.variant}: ${r.promptSources.join(', ')}`).join('; ');
    const dates = [...new Set(runs.map((r) => r.ranAt.slice(0, 10)))].join(', ');
    const lines = [
      `**${suite.title}**: ${runs[0]!.itemCount} items, run on ${dates} (${sources}).`,
      '',
      '| Score | Items | v1 | v2 | Change |',
      '| --- | ---: | ---: | ---: | ---: |',
    ];

    for (const info of suite.scores) {
      const before = v1?.scores[info.name];
      const after = v2?.scores[info.name];
      const n = before?.n ?? after?.n ?? 0;
      lines.push(
        `| ${info.label} | ${n} | ${before ? percent(before.mean) : 'not run'} | ${after ? percent(after.mean) : 'not run'} | ${change(before && Math.round(before.mean * 100), after && Math.round(after.mean * 100), (d) => `${d} pts`)} |`,
      );
    }

    const seconds = (r?: RunRecord) => (r ? r.latencySeconds.toFixed(1) : 'not run');
    const tokens = (r?: RunRecord) => (r ? Math.round(r.outputTokens).toLocaleString('en-US') : 'not run');
    lines.push(
      `| Seconds per item | ${runs[0]!.itemCount} | ${seconds(v1)} | ${seconds(v2)} | ${change(v1 && Number(v1.latencySeconds.toFixed(1)), v2 && Number(v2.latencySeconds.toFixed(1)), (d) => d.toFixed(1))} |`,
      `| Output tokens per item | ${runs[0]!.itemCount} | ${tokens(v1)} | ${tokens(v2)} | ${change(v1 && Math.round(v1.outputTokens), v2 && Math.round(v2.outputTokens), (d) => d.toLocaleString('en-US'))} |`,
    );

    const failed = runs.flatMap((r) => r.failedItems.map((id) => `${id} (${r.variant})`));
    if (failed.length > 0) lines.push('', `Not scored because the task failed: ${failed.join(', ')}.`);
    sections.push(lines.join('\n'));
  }

  return sections.length > 0
    ? sections.join('\n\n')
    : 'No results yet. Run `pnpm evals`, then `pnpm evals:report --write`.';
}

/** Replaces the text between the eval-results markers. */
export function replaceBetweenMarkers(document: string, content: string): string {
  const start = '<!-- eval-results:start -->';
  const end = '<!-- eval-results:end -->';
  const from = document.indexOf(start);
  const to = document.indexOf(end);
  if (from === -1 || to === -1 || to < from) {
    throw new Error(`The README needs ${start} and ${end} markers.`);
  }
  return `${document.slice(0, from + start.length)}\n${content}\n${document.slice(to)}`;
}
