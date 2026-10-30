import { hours, minutes } from '@nestjs/throttler';

/**
 * Per-IP limits. The demo has no accounts and every Claude call costs money,
 * so the routes and events that call Claude get tighter limits of their own.
 * They slow one client down; they are not a budget. The hard cap is the spend
 * limit on the Anthropic workspace that owns the API key (docs/deploy.md).
 */
export const RATE_LIMITS = {
  /** Every HTTP route without a limit of its own. */
  default: { limit: 120, ttl: minutes(1) },
  createStudy: { limit: 30, ttl: hours(1) },
  generateQuestionnaire: { limit: 10, ttl: hours(1) },
  generateInsights: { limit: 10, ttl: hours(1) },
  /** Socket.io: a browser joins on every connect, and a new id starts a new interview. */
  joinInterview: { limit: 30, ttl: minutes(10) },
  /** Socket.io: each answer costs one or two Claude calls. */
  answer: { limit: 60, ttl: minutes(10) },
} as const;
