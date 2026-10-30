import { defineRailway, github, mongo, project, service } from 'railway/iac';

/**
 * The Railway side of the deploy: the API and its MongoDB, as code.
 * `railway config plan` shows what would change in the linked Railway
 * project and `railway config apply` makes those changes, much like
 * `terraform plan` and `terraform apply`. Railway does not read this file when
 * it deploys; it is applied from a laptop or CI, and each push to main then
 * builds and deploys the API with the settings it set.
 *
 * The repository is public, so no secret goes in this file. Secrets live in
 * the Railway project's shared variables, and `ctx.shared.NAME` only
 * references them (it becomes `${{shared.NAME}}`, resolved by Railway at
 * deploy time). docs/deploy.md has the full walkthrough.
 */
// Amsterdam: close to the EU Langfuse and PostHog hosts below.
const REGION = 'europe-west4-drams3a';

export default defineRailway((ctx) => {
  // Railway's MongoDB template: one node on a volume, reachable only over the
  // project's private network. MongoDB is the name the template gives it, and
  // names are how this file finds what already exists in the project.
  const db = mongo('MongoDB', { region: REGION });

  const api = service('api', {
    source: github('ozykhan/bolt-insight-study', { branch: 'main' }),
    // A pnpm workspace deploys from the repo root, because the API imports
    // packages/shared. Railpack installs the whole workspace, then this builds
    // shared and the API (the trailing ... in the filter means "and its
    // workspace dependencies").
    build: {
      builder: 'RAILPACK',
      buildCommand: 'pnpm --filter @probe-lab/api... build',
      // Only a change the API can see starts a new deploy.
      watchPatterns: [
        '/apps/api/**',
        '/packages/shared/**',
        '/package.json',
        '/pnpm-lock.yaml',
        '/pnpm-workspace.yaml',
      ],
    },
    start: 'node apps/api/dist/main.js',
    // Railway moves traffic to a new deploy only after this answers 200.
    healthcheck: '/api/health',
    healthcheckTimeout: 120,
    deploy: {
      restartPolicyType: 'ON_FAILURE',
      restartPolicyMaxRetries: 5,
      // Time between SIGTERM and SIGKILL, so shutdown hooks can flush
      // Langfuse traces and PostHog events.
      drainingSeconds: 15,
    },
    // Interview rooms, the moderator's turn lock and the rate limit counters
    // are in memory, so the API runs as one replica, next to its database.
    regions: { [REGION]: 1 },
    env: {
      // A typed reference: Railway fills in the private network URL.
      MONGODB_URI: db.env.MONGO_URL,
      MONGODB_DB_NAME: 'probe-lab',
      // Railway's edge proxy sets this to the client's IP.
      CLIENT_IP_HEADER: 'x-real-ip',
      // Comma-separated web origins allowed by CORS: the Vercel domain.
      WEB_ORIGIN: ctx.shared.WEB_ORIGIN,
      ANTHROPIC_API_KEY: ctx.shared.ANTHROPIC_API_KEY,
      LANGFUSE_PUBLIC_KEY: ctx.shared.LANGFUSE_PUBLIC_KEY,
      LANGFUSE_SECRET_KEY: ctx.shared.LANGFUSE_SECRET_KEY,
      // EU regions. For US, use https://us.cloud.langfuse.com and https://us.i.posthog.com.
      LANGFUSE_BASE_URL: 'https://cloud.langfuse.com',
      // Tags these traces so Langfuse can tell them apart from local runs.
      LANGFUSE_TRACING_ENVIRONMENT: 'production',
      POSTHOG_PROJECT_KEY: ctx.shared.POSTHOG_PROJECT_KEY,
      POSTHOG_HOST: 'https://eu.i.posthog.com',
    },
  });

  return project('probe-lab', { resources: [api, db] });
});
