import type { ChatAnthropic } from '@langchain/anthropic';
import { BaseCallbackHandler } from '@langchain/core/callbacks/base';
import type { Callbacks } from '@langchain/core/callbacks/manager';
import type { LLMResult } from '@langchain/core/outputs';
import type { Evaluation, LangfuseClient } from '@langfuse/client';
import type { PromptVersion } from '@probe-lab/shared';
import type { Effort } from '../src/llm/chat-model.js';

/** One test case. The id is stable, so syncing the dataset updates the item instead of adding a copy. */
export interface EvalItem<Input, Expected> {
  id: string;
  input: Input;
  expectedOutput: Expected;
}

export interface EvalContext {
  variant: PromptVersion;
  /** Null in unit tests; prompts then come from the repo. */
  langfuse: LangfuseClient | null;
  model: (effort: Effort) => ChatAnthropic;
  /** Callbacks for judge calls, so their traces stay apart from the task's. */
  judgeCallbacks: () => Callbacks;
}

export type SuiteEvaluator<Input, Expected, Output> = (params: {
  input: Input;
  output: Output;
  expectedOutput: Expected;
}) => Promise<Evaluation[]>;

export interface PreparedSuite<Input, Expected, Output> {
  task: (item: EvalItem<Input, Expected>, callbacks: Callbacks) => Promise<Output>;
  evaluators: Array<SuiteEvaluator<Input, Expected, Output>>;
  /** Where each prompt came from, for example `brief-expansion@langfuse:4`. */
  promptSources: string[];
}

export interface ScoreInfo {
  name: string;
  label: string;
  description: string;
}

export interface EvalSuite<Input, Expected, Output> {
  name: string;
  /** The Langfuse dataset the items are synced to. */
  dataset: string;
  description: string;
  items: Array<EvalItem<Input, Expected>>;
  /** Every score, in report order. Higher is better for all of them, from 0 to 1. */
  scores: ScoreInfo[];
  prepare(context: EvalContext): Promise<PreparedSuite<Input, Expected, Output>>;
}

/** A numeric score between 0 and 1, the only kind these evals produce. */
export function score(name: string, value: number, comment?: string): Evaluation {
  return { name, value, dataType: 'NUMERIC', ...(comment ? { comment } : {}) };
}

/**
 * Adds up token usage across every model call in a task. Langfuse has the
 * same numbers per trace; keeping them here too lets the results file show
 * the cost side of a prompt change next to the quality side.
 */
export class UsageTracker extends BaseCallbackHandler {
  name = 'usage-tracker';
  inputTokens = 0;
  outputTokens = 0;

  constructor() {
    // Await this handler, so the counts are final when the task returns.
    super({ _awaitHandler: true });
  }

  override handleLLMEnd(output: LLMResult): void {
    for (const generation of output.generations.flat()) {
      const usage = (generation as { message?: { usage_metadata?: { input_tokens: number; output_tokens: number } } })
        .message?.usage_metadata;
      this.inputTokens += usage?.input_tokens ?? 0;
      this.outputTokens += usage?.output_tokens ?? 0;
    }
  }
}

export interface ItemRecord {
  id: string;
  scores: Record<string, number>;
  comments: Record<string, string>;
  latencySeconds: number;
  inputTokens: number;
  outputTokens: number;
  output: unknown;
}

/** What one run of one suite on one prompt variant scored. Written to `evals/results/`. */
export interface RunRecord {
  suite: string;
  variant: PromptVersion;
  ranAt: string;
  runName: string;
  experimentUrl: string | null;
  model: string;
  promptSources: string[];
  itemCount: number;
  failedItems: string[];
  /** Mean of each score over the items it applies to, and how many items that was. */
  scores: Record<string, { mean: number; n: number }>;
  /** Means per item, for the task only (judge calls are not counted). */
  latencySeconds: number;
  inputTokens: number;
  outputTokens: number;
  items: ItemRecord[];
}

const mean = (values: number[]) =>
  values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;

/** Averages each score over the items that have it, and the task's latency and tokens over all items. */
export function aggregate(items: ItemRecord[]): Pick<
  RunRecord,
  'scores' | 'latencySeconds' | 'inputTokens' | 'outputTokens'
> {
  const byName = new Map<string, number[]>();
  for (const item of items) {
    for (const [name, value] of Object.entries(item.scores)) {
      byName.set(name, [...(byName.get(name) ?? []), value]);
    }
  }
  return {
    scores: Object.fromEntries(
      [...byName].map(([name, values]) => [name, { mean: mean(values), n: values.length }]),
    ),
    latencySeconds: mean(items.map((item) => item.latencySeconds)),
    inputTokens: mean(items.map((item) => item.inputTokens)),
    outputTokens: mean(items.map((item) => item.outputTokens)),
  };
}
