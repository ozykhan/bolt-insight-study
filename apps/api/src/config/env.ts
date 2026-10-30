import { z } from 'zod';

const optional = z
  .string()
  .optional()
  .transform((value) => (value ? value : undefined));

/**
 * Every environment variable the API reads. ConfigModule calls `validateEnv`
 * at startup, so a typo in `.env` fails fast instead of at the first request.
 * The LLM, Langfuse and PostHog keys are optional so the app, the tests and
 * the UI can run without them; calls that need a key fail with a clear
 * message instead, and analytics are skipped.
 */
export const EnvSchema = z.object({
  API_PORT: z.coerce.number().int().positive().default(3000),
  // Hosts such as Railway assign the port through PORT. It wins over API_PORT.
  PORT: z.coerce.number().int().positive().optional(),
  // Comma-separated, for example the Vercel domain plus a custom domain. A
  // trailing slash never matches the browser's Origin header, so it is dropped.
  WEB_ORIGIN: z
    .string()
    .default('http://localhost:5173')
    .transform((value) =>
      value
        .split(',')
        .map((origin) => origin.trim().replace(/\/+$/, ''))
        .filter(Boolean),
    ),
  // A header the host's edge proxy sets to the client's IP, such as Railway's
  // x-real-ip. Rate limits key on it; without it they use the socket address.
  CLIENT_IP_HEADER: optional,
  MONGODB_URI: z.string().default('mongodb://localhost:27017/probe-lab'),
  // Overrides the database named in MONGODB_URI. Railway's MONGO_URL names none.
  MONGODB_DB_NAME: optional,
  ANTHROPIC_API_KEY: optional,
  ANTHROPIC_MODEL: z.string().default('claude-opus-5-5'),
  LANGFUSE_PUBLIC_KEY: optional,
  LANGFUSE_SECRET_KEY: optional,
  LANGFUSE_BASE_URL: z.string().default('https://cloud.langfuse.com'),
  POSTHOG_PROJECT_KEY: optional,
  POSTHOG_HOST: z.string().default('https://us.i.posthog.com'),
});

export type Env = z.infer<typeof EnvSchema>;

export function validateEnv(raw: Record<string, unknown>): Env {
  const result = EnvSchema.safeParse(raw);
  if (!result.success) {
    throw new Error(`Invalid environment:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}
