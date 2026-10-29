import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ChatAnthropic } from '@langchain/anthropic';
import { LangfuseClient } from '@langfuse/client';
import { CallbackHandler } from '@langfuse/langchain';
import type { Env } from '../config/env.js';
import { flushTraces } from '../instrumentation.js';
import { createChatModel, type Effort } from './chat-model.js';
import { loadChatPrompt, type LoadedPrompt, type PromptDefinition } from './prompts.js';

/**
 * Builds Claude chat models from config. Services ask for a model per call
 * instead of sharing one instance, so each call site picks its own effort.
 * Tests swap this provider for one that returns a model with a stubbed client.
 */
@Injectable()
export class ChatModelFactory {
  constructor(private readonly config: ConfigService<Env, true>) {}

  get modelName(): string {
    return this.config.get('ANTHROPIC_MODEL', { infer: true });
  }

  create(options: { effort: Effort; streaming?: boolean }): ChatAnthropic {
    return createChatModel({
      apiKey: this.config.get('ANTHROPIC_API_KEY', { infer: true }),
      model: this.modelName,
      ...options,
    });
  }
}

export interface TraceAttributes {
  /** Groups traces in Langfuse's Sessions view, for example one study or one interview. */
  sessionId?: string;
  userId?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

@Injectable()
export class LangfuseService implements OnApplicationShutdown {
  private readonly logger = new Logger(LangfuseService.name);
  readonly client: LangfuseClient | null;

  constructor(config: ConfigService<Env, true>) {
    const publicKey = config.get('LANGFUSE_PUBLIC_KEY', { infer: true });
    const secretKey = config.get('LANGFUSE_SECRET_KEY', { infer: true });
    this.client =
      publicKey && secretKey
        ? new LangfuseClient({
            publicKey,
            secretKey,
            baseUrl: config.get('LANGFUSE_BASE_URL', { infer: true }),
          })
        : null;
    if (!this.client) {
      this.logger.warn('Langfuse keys not set: tracing is off and prompts come from the repo.');
    }
  }

  /**
   * A LangChain callback handler. Pass it in `callbacks` on invoke/stream and
   * every chain step and model call in that run becomes a span in one
   * Langfuse trace, with token usage, latency and (from Langfuse's model price
   * table) cost. After the run, `handler.last_trace_id` holds the trace id.
   */
  handler(attributes: TraceAttributes = {}): CallbackHandler {
    return new CallbackHandler({
      sessionId: attributes.sessionId,
      userId: attributes.userId,
      tags: attributes.tags,
      traceMetadata: attributes.metadata,
    });
  }

  loadPrompt(definition: PromptDefinition, label = 'production'): Promise<LoadedPrompt> {
    return loadChatPrompt(this.client, definition, label);
  }

  async onApplicationShutdown(): Promise<void> {
    await flushTraces();
  }
}
