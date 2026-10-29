import { Injectable } from '@nestjs/common';
import type { Runnable } from '@langchain/core/runnables';
import type { InsightsDraft } from '@probe-lab/shared';
import { ChatModelFactory, LangfuseService } from '../llm/llm.providers.js';
import { createInsightsChain, type InsightsInput } from './insights.chain.js';
import { INSIGHTS_SUMMARY_PROMPT } from './insights.prompt.js';

export interface LoadedInsightsChain {
  chain: Runnable<InsightsInput, InsightsDraft>;
  /** Where the prompt came from, for example `langfuse:2`. */
  promptSource: string;
}

/** A provider of its own so the e2e test can script the model's reply. */
@Injectable()
export class InsightsChainFactory {
  constructor(
    private readonly models: ChatModelFactory,
    private readonly langfuse: LangfuseService,
  ) {}

  async create(): Promise<LoadedInsightsChain> {
    const prompt = await this.langfuse.loadPrompt(INSIGHTS_SUMMARY_PROMPT);
    return {
      chain: createInsightsChain(prompt.template, this.models.create({ effort: 'medium' })),
      promptSource: prompt.source,
    };
  }
}
