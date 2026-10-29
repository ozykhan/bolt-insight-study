import './load-env.js';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { LangfuseSpanProcessor } from '@langfuse/otel';

/**
 * Langfuse's JS SDK is built on OpenTelemetry: the LangChain callback handler
 * creates spans, and this span processor batches them and ships them to
 * Langfuse. main.ts imports this file first so the processor is registered
 * before any span is created.
 *
 * Without Langfuse keys nothing is registered and spans go to OpenTelemetry's
 * no-op tracer, so local runs without keys still work.
 */
const langfuseConfigured = Boolean(
  process.env.LANGFUSE_PUBLIC_KEY && process.env.LANGFUSE_SECRET_KEY,
);

export const langfuseSpanProcessor = langfuseConfigured ? new LangfuseSpanProcessor() : null;

if (langfuseSpanProcessor) {
  const sdk = new NodeSDK({ spanProcessors: [langfuseSpanProcessor] });
  sdk.start();
}

/** Sends any buffered spans. Call before a short-lived process exits. */
export async function flushTraces(): Promise<void> {
  await langfuseSpanProcessor?.forceFlush();
}
