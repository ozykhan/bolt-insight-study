import { Injectable } from '@nestjs/common';
import type { PromptVersion } from '@probe-lab/shared';
import { ChatModelFactory, LangfuseService } from '../llm/llm.providers.js';
import { createModeratorChains } from './moderator/moderator.chains.js';
import type { ModeratorChains } from './moderator/moderator.graph.js';
import {
  MODERATOR_BRIDGE_PROMPT,
  MODERATOR_DECIDE_PROMPT,
  MODERATOR_FOLLOW_UP_PROMPT,
} from './moderator/moderator.prompts.js';

export interface LoadedModeratorChains {
  chains: ModeratorChains;
  /** Where each prompt came from, for trace tags, for example `langfuse:4`. */
  promptSources: string[];
}

/**
 * Builds the moderator's chains for one prompt version. A provider of its
 * own so the e2e test can replace the LLM calls with scripted ones.
 */
@Injectable()
export class ModeratorChainsFactory {
  constructor(
    private readonly models: ChatModelFactory,
    private readonly langfuse: LangfuseService,
  ) {}

  async create(promptVersion: PromptVersion): Promise<LoadedModeratorChains> {
    const [decide, followUp, bridge] = await Promise.all([
      this.langfuse.loadPrompt(MODERATOR_DECIDE_PROMPT, promptVersion),
      this.langfuse.loadPrompt(MODERATOR_FOLLOW_UP_PROMPT, promptVersion),
      this.langfuse.loadPrompt(MODERATOR_BRIDGE_PROMPT),
    ]);
    // Low effort keeps chat turns quick; the model still thinks a little.
    const chains = createModeratorChains({
      prompts: { decide: decide.template, followUp: followUp.template, bridge: bridge.template },
      decideModel: this.models.create({ effort: 'low' }),
      speakModel: this.models.create({ effort: 'low' }),
    });
    return {
      chains,
      promptSources: [decide, followUp, bridge].map((p) => `${p.name}@${p.source}`),
    };
  }
}
