# Deploying Probe Lab

The API and its MongoDB run on Railway. The web app runs on Vercel.

```txt
browser ──https──> Vercel: the React build (static files on a CDN)
   │
   └──https + WebSocket──> Railway: api (NestJS) ──private network──> Railway: mongo
                                   │
                                   └──> Anthropic, Langfuse, PostHog
```

## Why this split

- The moderator streams its replies over Socket.io, so the API has to be a long-running process that holds WebSocket connections. Railway runs it as a container. Its edge proxy keeps WebSockets open with no time limit and lets plain HTTP requests run for up to 15 minutes, which covers the 20 to 60 second questionnaire and summary calls.
- The web app is static files after `vite build`. Vercel serves them from its CDN and builds a preview for every branch.
- The two are on different origins, so the browser talks to the API directly: the web build gets the API's URL in `VITE_API_URL`, and the API allows the web origin with CORS.
- MongoDB runs next to the API on Railway's private network, so it never needs a public port.

## The repository is public

What keeps that safe:

- **No secret is in git.** I checked the whole history: no key was ever committed, and `.env` is ignored. Secrets live in Railway shared variables and Vercel environment variables. `.railway/railway.ts` only references them by name.
- **Some values are public by design.** Everything the browser gets is readable by anyone: the API URL and the PostHog project key are compiled into the JavaScript bundle. Never put a secret in a `VITE_` variable.
- **CORS is not access control.** It stops other websites' scripts in a browser from calling the API. It does not stop curl or a script.
- **Rate limits slow down a single client.** Limits are per IP, and tighter where Claude is called (`apps/api/src/common/rate-limits.ts`):

  | What | Limit per IP |
  | --- | --- |
  | Any HTTP route | 120 a minute |
  | Create a study | 30 an hour |
  | Draft a questionnaire | 10 an hour |
  | Write the summary | 10 an hour |
  | Join an interview (socket) | 30 in 10 minutes |
  | Answer (socket) | 60 in 10 minutes |

- **The hard cap is a spend limit.** Rate limits do not stop many IPs at once. In the Claude Console, create a workspace just for this demo, set a monthly spend limit on it (for example $20), and create the API key inside that workspace. When the limit is reached, Claude calls fail and the app says so; nothing else breaks. Railway has the same idea for hosting costs: set a hard limit on the Workspace Usage page.
- **There is no auth.** Anyone with the URL can see every study and transcript. Use made-up data only.

## Before you start

- A Railway account. The Hobby plan is $5 a month and includes $5 of usage; a new account gets a one-time $5 trial credit.
- A Vercel account (Hobby is free).
- The Railway CLI, version 5.42.1 or newer: `brew install railway`.
- The keys from your local `.env`, ideally with the Anthropic key replaced by one from the demo workspace above.
- This branch merged into `main`. Railway and Vercel build from `main`.

## 1. Create the Railway project and its secrets

```sh
railway login
cd bolt-insight-study
railway init --name probe-lab    # creates the project and links this folder to it
```

In the Railway dashboard, open the project, then **Settings > Shared Variables**, pick the `production` environment, and add:

| Variable | Value |
| --- | --- |
| `ANTHROPIC_API_KEY` | The demo workspace's key |
| `LANGFUSE_PUBLIC_KEY` | From your Langfuse project |
| `LANGFUSE_SECRET_KEY` | From your Langfuse project |
| `POSTHOG_PROJECT_KEY` | From your PostHog project |
| `WEB_ORIGIN` | `http://localhost:5173` for now; step 5 replaces it |

Shared variables are project-level. The API service gets them through references like `${{shared.ANTHROPIC_API_KEY}}`, which Railway resolves at deploy time.

## 2. Create the API and MongoDB with Infrastructure as Code

`.railway/railway.ts` describes the Railway side: an `api` service built from this repo and a `mongo` database, with the build command, start command, health check, watch paths and variables. Railway's CLI compares it with the project and applies the difference, like `terraform plan` and `terraform apply`.

Why not `railway.json`: Railway deprecated Config as Code (`railway.json` and `railway.toml`) in August 2026. New services cannot opt into it, and existing files stop being read on 2026-12-01. See the banner on [Config as Code](https://docs.railway.com/config-as-code), the [Infrastructure as Code](https://docs.railway.com/infrastructure-as-code) page that replaces it, and the [docs change that deprecated it](https://github.com/railwayapp/docs/pull/1304).

```sh
pnpm install            # installs the railway SDK that the file imports
railway config plan     # read-only: should list the api service, the mongo database and the api's variables
railway config apply    # asks for confirmation, then creates them
```

Railway then builds the API with Railpack: it reads `packageManager` (pnpm 10.28.0) and `engines.node` (22.x) from `package.json`, installs the whole workspace, runs `pnpm --filter @probe-lab/api... build` and starts `node apps/api/dist/main.js`. The deploy goes live once `GET /api/health` answers 200, which needs MongoDB to be connected.

If the build cannot reach the repository, install the [Railway GitHub app](https://github.com/apps/railway-app) for `ozykhan/bolt-insight-study` and redeploy.

## 3. Give the API a public URL

```sh
railway domain --service api
curl https://<the-domain-it-printed>/api/health    # {"status":"ok"}
```

Keep that URL for the next step.

## 4. Deploy the web app on Vercel

1. On [vercel.com/new](https://vercel.com/new), import `ozykhan/bolt-insight-study`.
2. Set **Root Directory** to `apps/web`. Leave the build settings alone: `apps/web/vercel.json` sets the framework, the build command (which builds `packages/shared` first) and the output folder, and sends every path to `index.html` so links like `/s/<studyId>` work on a fresh load.
3. Add these environment variables:

   | Variable | Value |
   | --- | --- |
   | `VITE_API_URL` | The Railway URL from step 3, such as `https://api-production-1234.up.railway.app` |
   | `POSTHOG_PROJECT_KEY` | Same as on Railway |
   | `POSTHOG_HOST` | `https://eu.i.posthog.com` |

4. Deploy. Vercel picks pnpm 10 from the root `packageManager` field and installs the workspace from the repo root.

These variables are written into the bundle at build time, so changing one needs a redeploy.

## 5. Let the web app call the API

Back in Railway's shared variables, set `WEB_ORIGIN` to the Vercel URL, for example `https://probe-lab.vercel.app` (no path; a trailing slash is fine). For more than one origin, separate them with commas. Deploy the staged change when Railway asks.

## 6. Check it end to end

1. Open the Vercel URL, create a study, draft and launch the questionnaire.
2. Open the respondent link in a private window and finish an interview.
3. Write the summary.
4. In Langfuse, the traces carry the `production` environment. In PostHog, the funnel events arrive.

If the page loads but every call fails, the browser console will show a CORS error: `WEB_ORIGIN` does not match the page's origin exactly.

## Day to day

- A push to `main` redeploys the web app on Vercel, and redeploys the API on Railway when it touches `apps/api`, `packages/shared` or the workspace files.
- Vercel builds a preview for every branch. Previews call the production API, and their origins are not in `WEB_ORIGIN`, so add one there if you want a preview to work.
- `railway logs --service api` tails the API's logs.
- To change the Railway setup, edit `.railway/railway.ts`, then `railway config plan` and `railway config apply`.
- `railway variable --set-from-stdin NAME --service api` sets a single variable without it landing in your shell history.

## Clicking instead of the CLI

The same setup by hand, if you prefer: create a project from the GitHub repo, add a MongoDB database with **+ New > Database**, and in the API service's settings set the build command `pnpm --filter @probe-lab/api... build`, the start command `node apps/api/dist/main.js`, the health check path `/api/health` and the watch paths from `.railway/railway.ts`. Its variables are `MONGODB_URI=${{MongoDB.MONGO_URL}}` (use the database service's name), `MONGODB_DB_NAME=probe-lab`, `CLIENT_IP_HEADER=x-real-ip` and the rest as in the file. Do not mix the two: once you apply the file, edit the file rather than the dashboard.

## What changes for real traffic

- **More than one API instance.** Interview rooms, the moderator's turn lock and the rate limit counters live in memory. Several instances need the Socket.io Redis adapter, the lock and the counters in Redis, and either sticky sessions or WebSocket-only connections, because Socket.io's polling transport must reach the same instance every time.
- **Accounts**, so studies belong to someone and limits can be per user, not per IP.
- **Backups.** Railway's MongoDB is one node on a volume; turn on volume backups or high availability.
- **One domain.** With the web app on `app.example.com` and the API on `api.example.com`, both are same-site, which matters once there are cookies.
