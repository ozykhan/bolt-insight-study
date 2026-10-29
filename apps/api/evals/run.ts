/**
 * Runs the eval suites as Langfuse experiments.
 *
 *   pnpm evals                              every suite, prompt v1 then v2
 *   pnpm evals moderator --variant v2       one suite, one variant
 *   pnpm evals brief-expansion --limit 2    a quick, cheap check of the wiring
 *
 * For each suite and variant it syncs the items to a Langfuse dataset, runs
 * the task and the evaluators on every item with `langfuse.experiment.run`,
 * and writes the scores to `evals/results/<suite>.<variant>.json`.
 * `pnpm evals:report` turns those files into the table in the README.
 */
import '../src/instrumentation.js';
import { mkdir, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { LangfuseClient, type FetchedDataset } from '@langfuse/client';
import { CallbackHandler } from '@langfuse/langchain';
import { PROMPT_VERSIONS, type PromptVersion } from '@probe-lab/shared';
import { validateEnv } from '../src/config/env.js';
import { createChatModel } from '../src/llm/chat-model.js';
import { flushTraces } from '../src/instrumentation.js';
import { briefExpansionSuite } from './brief-expansion.suite.js';
import { moderatorSuite } from './moderator.suite.js';
import {
  UsageTracker,
  aggregate,
  type EvalContext,
  type EvalSuite,
  type ItemRecord,
  type RunRecord,
} from './harness.js';

// Each suite has its own input and output types; the runner only passes them through.
type AnySuite = EvalSuite<any, any, any>;

const SUITES: Record<string, AnySuite> = {
  [briefExpansionSuite.name]: briefExpansionSuite,
  [moderatorSuite.name]: moderatorSuite,
};

const RESULTS_DIR = new URL('./results/', import.meta.url);

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    variant: { type: 'string', default: 'both' },
    limit: { type: 'string' },
    concurrency: { type: 'string', default: '3' },
  },
});

const env = validateEnv(process.env);
const missing = (['ANTHROPIC_API_KEY', 'LANGFUSE_PUBLIC_KEY', 'LANGFUSE_SECRET_KEY'] as const).filter(
  (key) => !env[key],
);
if (missing.length > 0) {
  console.error(`Set ${missing.join(', ')} in the root .env first.`);
  process.exit(1);
}

const suiteNames = positionals.length > 0 ? positionals : Object.keys(SUITES);
const unknown = suiteNames.filter((name) => !SUITES[name]);
if (unknown.length > 0) {
  console.error(`Unknown suite: ${unknown.join(', ')}. Choose from ${Object.keys(SUITES).join(', ')}.`);
  process.exit(1);
}
const variants: PromptVersion[] =
  values.variant === 'both' ? [...PROMPT_VERSIONS] : [values.variant as PromptVersion];
if (!variants.every((v) => PROMPT_VERSIONS.includes(v))) {
  console.error(`--variant must be one of ${PROMPT_VERSIONS.join(', ')} or both.`);
  process.exit(1);
}
const limit = values.limit ? Number(values.limit) : undefined;
const concurrency = Number(values.concurrency);

const langfuse = new LangfuseClient({
  publicKey: env.LANGFUSE_PUBLIC_KEY,
  secretKey: env.LANGFUSE_SECRET_KEY,
  baseUrl: env.LANGFUSE_BASE_URL,
});

function context(variant: PromptVersion): EvalContext {
  return {
    variant,
    langfuse,
    model: (effort) => createChatModel({ apiKey: env.ANTHROPIC_API_KEY, model: env.ANTHROPIC_MODEL, effort }),
    judgeCallbacks: () => [new CallbackHandler({ tags: ['eval-judge', `prompt-${variant}`] })],
  };
}

/**
 * Creates the dataset if it is missing and upserts every item by id, so the
 * repo stays the source of truth for the test cases and Langfuse keeps the
 * history of runs against them.
 */
async function syncDataset(suite: AnySuite): Promise<FetchedDataset> {
  try {
    await langfuse.api.datasets.get(suite.dataset);
  } catch {
    await langfuse.api.datasets.create({ name: suite.dataset, description: suite.description });
  }
  for (const item of suite.items) {
    await langfuse.dataset.createItem({
      datasetName: suite.dataset,
      id: `${suite.name}-${item.id}`,
      input: item.input,
      expectedOutput: item.expectedOutput,
      metadata: { caseId: item.id },
    });
  }
  return langfuse.dataset.get(suite.dataset);
}

async function runSuite(suite: AnySuite, variant: PromptVersion): Promise<RunRecord> {
  const prepared = await suite.prepare(context(variant));
  const dataset = await syncDataset(suite);

  // Run the repo's items, in the repo's order, linked to their Langfuse dataset items.
  const order = suite.items.map((item) => item.id);
  const caseId = (item: { metadata?: unknown }) => (item.metadata as { caseId?: string } | undefined)?.caseId ?? '';
  const linked = dataset.items
    .filter((item) => item.status === 'ACTIVE' && order.includes(caseId(item)))
    .sort((a, b) => order.indexOf(caseId(a)) - order.indexOf(caseId(b)))
    .slice(0, limit);
  const local = new Map(suite.items.map((item) => [item.id, item]));

  const usage = new Map<string, Pick<ItemRecord, 'latencySeconds' | 'inputTokens' | 'outputTokens'>>();
  const runName = `${suite.name}-${variant}-${new Date().toISOString()}`;
  console.log(`\n${runName}: ${linked.length} items, prompts ${prepared.promptSources.join(', ')}`);

  const result = await langfuse.experiment.run({
    name: `${suite.name} ${variant}`,
    runName,
    description: suite.description,
    metadata: { variant, model: env.ANTHROPIC_MODEL, promptSources: prepared.promptSources },
    data: linked,
    maxConcurrency: concurrency,
    task: async (item) => {
      const id = caseId(item);
      const tracker = new UsageTracker();
      const handler = new CallbackHandler({ tags: ['eval', suite.name, `prompt-${variant}`] });
      const started = performance.now();
      const output = await prepared.task(local.get(id)!, [handler, tracker]);
      usage.set(id, {
        latencySeconds: (performance.now() - started) / 1000,
        inputTokens: tracker.inputTokens,
        outputTokens: tracker.outputTokens,
      });
      return output;
    },
    evaluators: prepared.evaluators.map((evaluate) => async (params) => {
      const item = local.get(caseId({ metadata: params.metadata }))!;
      return evaluate({ input: item.input, expectedOutput: item.expectedOutput, output: params.output });
    }),
  });

  const items: ItemRecord[] = result.itemResults.map((itemResult) => {
    const id = caseId(itemResult.item);
    return {
      id,
      scores: Object.fromEntries(itemResult.evaluations.map((e) => [e.name, Number(e.value)])),
      comments: Object.fromEntries(itemResult.evaluations.map((e) => [e.name, e.comment ?? ''])),
      ...usage.get(id)!,
      output: itemResult.output,
    };
  });
  const finished = new Set(items.map((item) => item.id));

  console.log(await result.format());
  return {
    suite: suite.name,
    variant,
    ranAt: new Date().toISOString(),
    runName,
    experimentUrl: result.experimentUrl ?? null,
    model: env.ANTHROPIC_MODEL,
    promptSources: prepared.promptSources,
    itemCount: linked.length,
    failedItems: linked.map(caseId).filter((id) => !finished.has(id)),
    ...aggregate(items),
    items,
  };
}

await mkdir(RESULTS_DIR, { recursive: true });
for (const name of suiteNames) {
  for (const variant of variants) {
    const record = await runSuite(SUITES[name]!, variant);
    // A limited run is a smoke test, so it does not overwrite the real results.
    const file = new URL(`${name}.${variant}${limit ? '.partial' : ''}.json`, RESULTS_DIR);
    await writeFile(file, `${JSON.stringify(record, null, 2)}\n`);
    console.log(`Wrote ${file.pathname}`);
    if (record.failedItems.length > 0) {
      console.warn(`Failed items (not scored): ${record.failedItems.join(', ')}`);
    }
  }
}

await langfuse.flush();
await flushTraces();
