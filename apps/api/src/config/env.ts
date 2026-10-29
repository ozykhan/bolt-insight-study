import { z } from 'zod';

const optional = z
  .string()
  .optional()
  .transform((value) => (value ? value : undefined));

/**
 * Every environment variable the API reads. ConfigModule calls `validateEnv`
 * at startup, so a typo in `.env` fails fast instead of at the first request.
 * The LLM and Langfuse keys are optional so the app, the tests and the UI can
 * run without them; calls that need a key fail with a clear message instead.
 */
export const EnvSchema = z.object({
  API_PORT: z.coerce.number().int().positive().default(3000),
  WEB_ORIGIN: z.string().default('http://localhost:5173'),
  MONGODB_URI: z.string().default('mongodb://localhost:27017/probe-lab'),
  ANTHROPIC_API_KEY: optional,
  ANTHROPIC_MODEL: z.string().default('claude-opus-5-5'),
  LANGFUSE_PUBLIC_KEY: optional,
  LANGFUSE_SECRET_KEY: optional,
  LANGFUSE_BASE_URL: z.string().default('https://cloud.langfuse.com'),
});

export type Env = z.infer<typeof EnvSchema>;

export function validateEnv(raw: Record<string, unknown>): Env {
  const result = EnvSchema.safeParse(raw);
  if (!result.success) {
    throw new Error(`Invalid environment:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}
