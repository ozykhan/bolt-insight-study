# Notes on the tools

What each new tool does, how the idiomatic way differs from doing it by hand, what was surprising, and what to do differently next time. These are working notes, added to as each day lands.

## NestJS

**What it does.** A framework on top of Express that organises a Node API into modules and wires them together with dependency injection. You write classes (controllers, services), mark them with decorators, list them in a module, and Nest builds the object graph and fills in constructor arguments.

**Idiomatic vs by hand.** With plain Express you create the database connection, pass it into a service factory, and pass the service into the router setup yourself. In Nest a service says what it needs in its constructor (`constructor(private readonly questionnaires: QuestionnairesService)`) and the module lists the providers. A few other pieces do the jobs you would usually hand-roll:

- `ConfigModule.forRoot({ validate })` checks the environment once at boot, and services read typed values through `ConfigService<Env, true>`.
- Pipes run before the handler, so the handler only sees clean, typed input. This repo uses Nest's `ParseObjectIdPipe` and a small `ZodValidationPipe` that reuses the zod schemas the web app also imports.
- Throwing `ConflictException` or `NotFoundException` from a service becomes the right HTTP status without any try/catch in the controller.
- In tests, `Test.createTestingModule({ imports: [AppModule] }).overrideProvider(ChatModelFactory).useValue(stub)` swaps one dependency inside the real app. That is how the e2e test runs the whole API with no API key.

**Surprises.**

- Nest 12 is ESM first. The package is `"type": "module"`, and imports in TypeScript source end in `.js`.
- `ConfigModule.forRoot({ validate })` runs when `AppModule` is imported, not when the app starts. Setting `MONGODB_URI` in a test's `beforeAll` was too late, so the e2e database name lives in the Vitest config's `env` instead.
- `@Global()` modules save importing the LLM module into every feature module, but they hide the dependency. Used once here, for infrastructure only.

**Next time.** Drafting a questionnaire holds an HTTP request open for up to a minute. Make it a background job from the start (Nest has `@nestjs/bullmq`) and push the result over the socket that Day 2 adds anyway.

## MongoDB with Mongoose

**What it does.** Mongoose adds schemas, casting and validation on top of the MongoDB driver. `@nestjs/mongoose` lets you write the schema as a class with `@Schema()` and `@Prop()`, register it with `MongooseModule.forFeature`, and inject the model with `@InjectModel(Study.name)`.

**Idiomatic vs by hand.** By hand you write `new Schema({ ... })` and a separate TypeScript interface, and keep them in sync. With the decorators the class is both the type and the schema. Questions are embedded in each questionnaire version (always read together), and versions are separate documents that point at their study (interviews will point at an exact version).

**Surprises.**

- `@Prop({ type: Types.ObjectId })` looks right but is the wrong class. `Types.ObjectId` is the value type, and the schema type is `Schema.Types.ObjectId`. With the wrong one, the "latest version" query did not cast the study id, found nothing, and every edit tried to save version 1. The unique index on `{ studyId, version }` turned that into a loud E11000 error instead of silent bad data, which is a good argument for putting invariants in indexes.

**Next time.** The next version number is "latest plus one", which can race if two saves land at the same moment. The unique index makes that an error rather than corruption, but a counter on the study updated with `$inc` would remove the race.

## LangChain JS

**What it does.** Building blocks for LLM calls: prompt templates, chat models behind one interface, output parsers, and Runnables that compose with `.pipe()` and all share `invoke`, `stream`, `batch` and callbacks.

**Idiomatic vs by hand.** By hand you would format a string, call the Anthropic SDK, `JSON.parse` the reply, validate it with zod, loop to retry, and add logging around each step. In LangChain the brief expansion chain is one line:

```ts
prompt.pipe(model.withStructuredOutput(QuestionnaireDraftSchema, { method: 'jsonSchema' }))
  .withRetry({ stopAfterAttempt: 2 });
```

Because every piece is a Runnable, a callback handler passed at `invoke` time (Langfuse, below) sees every step with no extra code.

**Surprises.**

- `withStructuredOutput` uses a forced tool call by default for Anthropic. The model used here always thinks, and the API rejects a forced tool choice when thinking is on, with a 400. `{ method: 'jsonSchema' }` uses the API's native JSON schema output instead.
- The API's JSON schema output cannot enforce every zod rule (string lengths, for example), so zod still validates the result, and the one retry covers a draft that breaks a rule.
- Calling `.withConfig()` after `.withRetry()` quietly resets the retry to 3 attempts, because it rebuilds the retry wrapper with defaults. A test that counts requests caught it. The run name is now passed at `invoke` time instead.
- LangChain relies on `instanceof` checks, so two copies of `@langchain/core` in `node_modules` break things in confusing ways. A pnpm override (see `pnpm-workspace.yaml`) keeps one copy.
- `ChatAnthropic` accepts a `createClient` option. The chain tests use it to run the real chain against a fake Anthropic client and assert on the exact request body.

**Next time.** Write the "count the requests and inspect the body" test before wiring the chain into a service. It caught two config bugs that never showed up as errors.

## Claude

**What it does.** The LLM behind brief expansion, and later the moderator and the summary. It is called through `@langchain/anthropic`.

**Idiomatic vs by hand.** The model id comes from config, not code, and a small `ChatModelFactory` builds a model per call so each call site picks its own settings. The configured model always uses extended thinking, so the only dial is `effort` (`low`, `medium`, `high`), passed as `outputConfig: { effort }`. Brief expansion uses `medium`.

**Surprises.** Thinking tokens count toward `maxTokens`, so the limit is set well above the size of the visible answer (16,000).

**Next time.** Try `low` effort for brief expansion and let the Day 3 evals decide whether quality drops. It would cut latency and cost.

## Langfuse

**What it does.** Observability for LLM apps: one trace per request with a span for each chain step and model call, plus token usage, latency and cost. It also does prompt management (versioned prompts with labels) and datasets and experiments for evals (Day 3).

**Idiomatic vs by hand.** By hand you would log the prompt, the response, the tokens and the timing yourself, and keep a price table to work out cost. The current JS SDK is built on OpenTelemetry:

1. `src/instrumentation.ts` registers a `LangfuseSpanProcessor` with the OpenTelemetry Node SDK. `main.ts` imports it first so it is in place before any span is created.
2. Each call passes `new CallbackHandler({ sessionId, userId, tags })` in `callbacks`. Every Runnable step becomes a span in one trace, and `sessionId` groups all calls for one study (and later one interview).
3. Prompts come from `langfuse.prompt.get(name, { type: 'chat', label: 'production', fallback })`. `getLangchainPrompt()` converts Langfuse's `{{var}}` into LangChain's `{var}`, and putting the prompt object in the run's metadata as `langfusePrompt` links each generation to its prompt version. That link is what lets Day 3 compare v1 and v2 by prompt version.

**Surprises.**

- Because it is OpenTelemetry underneath, versions matter. The newest OpenTelemetry SDK was outside the range the Langfuse packages accept, so the OpenTelemetry packages are pinned to the last matching release.
- Spans are sent in batches. A short-lived script has to flush before it exits, and the API flushes on shutdown (`enableShutdownHooks` plus `onApplicationShutdown`).
- The instrumentation file runs before Nest's `ConfigModule`, so it cannot rely on Nest to load `.env`. A tiny `load-env.ts` uses Node's built-in `process.loadEnvFile` first.

**Next time.** Agree on trace naming (run names, session ids, tags) before the first trace. Filtering in the UI depends on those names, and renaming later splits the history.

## pnpm workspaces

**What it does.** One repo with several packages. `workspace:*` links `packages/shared` into both apps, `pnpm --filter` runs a script in one package, and `pnpm -r --parallel` runs it in all of them.

**Surprises.**

- pnpm 10 does not run dependencies' install scripts unless you allow them (`onlyBuiltDependencies` in `pnpm-workspace.yaml`).
- The apps import the shared package's built output, so it has to be built before the apps typecheck or test. The root scripts build it first.

**Next time.** Let the apps read the shared package's TypeScript source directly (an exports condition, or TypeScript project references) so there is no build step to remember.

## LangGraph

Day 2.

## Socket.io

Day 2.

## PostHog

Day 2.
