import { Injectable, Logger, type OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PostHog } from 'posthog-node';
import {
  MODERATOR_PROMPT_FLAG,
  STUDY_GROUP,
  type AnalyticsEvent,
  type PromptVersion,
} from '@probe-lab/shared';
import type { Env } from '../config/env.js';

/**
 * Server-side product analytics with posthog-node.
 *
 * The browser owns the distinct id (posthog-js creates and stores it) and
 * sends it with every request, so events captured here land on the same
 * person as the browser's own events. Every event also carries the study as a
 * PostHog group, so a funnel can be read per study as well as per person.
 */
@Injectable()
export class AnalyticsService implements OnApplicationShutdown {
  private readonly logger = new Logger(AnalyticsService.name);
  private readonly client: PostHog | null;

  constructor(config: ConfigService<Env, true>) {
    const key = config.get('POSTHOG_PROJECT_KEY', { infer: true });
    this.client = key
      ? new PostHog(key, { host: config.get('POSTHOG_HOST', { infer: true }) })
      : null;
    if (!this.client) {
      this.logger.warn('POSTHOG_PROJECT_KEY not set: analytics are off and every interview uses prompt v1.');
    }
  }

  /** Queues an event. posthog-node batches and sends them in the background. */
  capture(
    distinctId: string | null,
    event: AnalyticsEvent,
    studyId: string,
    properties: Record<string, unknown> = {},
  ): void {
    if (!this.client || !distinctId) return;
    this.client.capture({
      distinctId,
      event,
      properties: { study_id: studyId, ...properties },
      groups: { [STUDY_GROUP]: studyId },
    });
  }

  /**
   * Picks the moderator prompt version for a respondent from the multivariate
   * flag. It is called once, when the interview is created, and the result is
   * stored on the interview so the prompt cannot change mid-conversation.
   * Reading the flag also sends PostHog a `$feature_flag_called` event.
   */
  async moderatorPromptVersion(distinctId: string): Promise<PromptVersion> {
    if (!this.client) return 'v1';
    try {
      const flags = await this.client.evaluateFlags(distinctId, {
        flagKeys: [MODERATOR_PROMPT_FLAG],
      });
      return flags.getFlag(MODERATOR_PROMPT_FLAG) === 'v2' ? 'v2' : 'v1';
    } catch (error) {
      this.logger.warn(`Could not read ${MODERATOR_PROMPT_FLAG}, using v1: ${String(error)}`);
      return 'v1';
    }
  }

  async onApplicationShutdown(): Promise<void> {
    // Sends whatever is still queued before the process exits.
    await this.client?.shutdown();
  }
}
