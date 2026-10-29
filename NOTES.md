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
- `@Global()` modules save importing the LLM module into every feature module, but they hide the dependency. Used for infrastructure only (LLM and analytics).
- Nest's dependency injection reads constructor parameter types from decorator metadata, and that metadata is real JavaScript. A parameter typed `Connection` from `import { Connection } from 'mongoose'` made the compiled output import `Connection` as a value, and Node's ESM loader cannot find named exports in Mongoose's CommonJS build. Typecheck and tests passed, and `node dist/main.js` crashed at boot. `import { type Connection }` fixes it (the `@InjectConnection()` token does the injecting), and CI now boots the built API so this kind of bug fails the build.

**Next time.** Drafting a questionnaire holds an HTTP request open for up to a minute. Make it a background job from the start (Nest has `@nestjs/bullmq`) and push the result over the Socket.io connection the app already has.

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

**Idiomatic vs by hand.** The model id comes from config, not code, and a small `ChatModelFactory` builds a model per call so each call site picks its own settings. The configured model always uses extended thinking, so the only dial is `effort` (`low`, `medium`, `high`), passed as `outputConfig: { effort }`. Brief expansion uses `medium`. The moderator uses `low` for every call, because a respondent is waiting on each one.

**Surprises.** Thinking tokens count toward `maxTokens`, so the limit is set well above the size of the visible answer (16,000).

**Next time.** Try `low` effort for brief expansion and let the brief expansion eval decide whether quality drops (`pnpm evals brief-expansion`). It would cut latency and cost.

## Langfuse

**What it does.** Observability for LLM apps: one trace per request with a span for each chain step and model call, plus token usage, latency and cost. It also does prompt management (versioned prompts with labels) and datasets and experiments for evals (see the next section).

**Idiomatic vs by hand.** By hand you would log the prompt, the response, the tokens and the timing yourself, and keep a price table to work out cost. The current JS SDK is built on OpenTelemetry:

1. `src/instrumentation.ts` registers a `LangfuseSpanProcessor` with the OpenTelemetry Node SDK. `main.ts` imports it first so it is in place before any span is created.
2. Each call passes `new CallbackHandler({ sessionId, userId, tags })` in `callbacks`. Every Runnable step becomes a span in one trace, and `sessionId` groups all calls for one study (and later one interview).
3. Prompts come from `langfuse.prompt.get(name, { type: 'chat', label: 'production', fallback })`. `getLangchainPrompt()` converts Langfuse's `{{var}}` into LangChain's `{var}`, and putting the prompt object in the run's metadata as `langfusePrompt` links each generation to its prompt version. That link is what lets the evals compare v1 and v2 by prompt version.

**Surprises.**

- Because it is OpenTelemetry underneath, versions matter. The newest OpenTelemetry SDK was outside the range the Langfuse packages accept, so the OpenTelemetry packages are pinned to the last matching release.
- Spans are sent in batches. A short-lived script has to flush before it exits, and the API flushes on shutdown (`enableShutdownHooks` plus `onApplicationShutdown`).
- The instrumentation file runs before Nest's `ConfigModule`, so it cannot rely on Nest to load `.env`. A tiny `load-env.ts` uses Node's built-in `process.loadEnvFile` first.
- The `langfusePrompt` link only works when the model call is a direct sibling of the prompt in the chain. The callback handler remembers the prompt against the prompt step's parent run and looks it up from the generation's parent run. `withStructuredOutput` wraps the model in its own sequence, so the generation's parent is that wrapper and the lookup misses. The first real run showed it: follow-ups and bridges are linked to their prompt versions in Langfuse, while brief expansion, decide and the summary are not. The prompt version still reaches every trace as a tag.

**Next time.** Agree on trace naming (run names, session ids, tags) before the first trace. Filtering in the UI depends on those names, and renaming later splits the history.

## Langfuse datasets and experiments (evals)

**What it does.** A dataset is a list of test cases (input, expected output, metadata) stored in Langfuse. An experiment runs a task function on every item, runs evaluator functions on each output, and records each item's trace and scores against the dataset, so two runs (prompt v1 and v2) can be compared item by item, with cost and latency next to the scores.

**Idiomatic vs by hand.** By hand you write a loop over a JSON file, call the chain, call a judge, and put the numbers in a spreadsheet. With the JS SDK:

- The test cases live in the repo (`evals/*.dataset.ts`). The runner creates the dataset if it is missing and upserts every item with `langfuse.dataset.createItem({ datasetName, id, input, expectedOutput })`. Upserting by a stable id keeps the repo as the source of truth and Langfuse as the history of runs.
- `langfuse.experiment.run({ name, runName, data, task, evaluators, maxConcurrency })` does the loop. Each item runs inside its own OpenTelemetry span, so the LangChain callback handler created inside the task nests every chain step and model call under that item's trace with no extra wiring.
- An evaluator is a plain async function that gets `{ input, output, expectedOutput, metadata }` and returns scores (`{ name, value, comment }`). The judges are LangChain chains with structured output, and the evaluators turn their verdicts into 0 to 1 scores in code, so the scoring rule (for example, "count the later question of a duplicate pair") is testable without a model.
- The suites are tested end to end against a fake Anthropic client, and I ran the real runner once against a fake Claude API and a fake Langfuse server to check the wiring before anyone spends money on it. The first real run then needed no code changes: `pnpm evals brief-expansion --limit 2` as a cheap check, then the full run.

**Surprises.**

- A task that throws does not fail the experiment. The SDK logs the error and skips the item, so a run can look fine with half its items missing. The runner records the ids of skipped items and the report prints them.
- Evaluators run after the item's span has closed, so judge calls do not land in the item's trace. They get their own callback handler and tag (`eval-judge`), which also keeps the judge's cost apart from the cost of the prompt under test.
- Dataset item ids are unique across the whole Langfuse project, not per dataset, so they are prefixed with the suite name.
- Asking Langfuse for a prompt label that does not exist yet (a `v2` that was never pushed) still works, because the repo copy is the fallback, but the SDK logs a full error with a stack trace for each one. Running `pnpm prompts:push` first keeps the output clean and links each generation to its prompt version.
- LangChain runs callback handlers in the background by default. The small handler that counts tokens per item is created with `_awaitHandler: true`, so its counts are final when the task returns.
- The decide prompt is the same in v1 and v2, which was meant to be a free check on run-to-run noise. In the real run it scored 100% both times, so it measured nothing. Running brief expansion v1 twice did the job instead: the same prompt moved by up to 5 points, more than v2 changed it.

**Next time.** Write the judge prompts and score a handful of outputs by hand before the first run, then compare my labels with the judge's. An LLM judge is a model too, and its numbers are only as good as that agreement.

## Grounded quotes in the summary

**What it does.** The insights summary must not invent quotes. Claude cites each quote by a short answer reference (`A12`), and code checks the quote against that answer before anything is saved.

**Idiomatic vs by hand.** The usual instinct is to ask the model more firmly ("quote exactly, never paraphrase"). The prompt does say that, but the guarantee comes from code: a quote must be a run of whole words from the cited answer, after folding case, spacing and curly quote marks. The saved quote is cut from the respondent's own text, not copied from the model's output, and it keeps the message id, so the UI can show the full answer behind it.

**Surprises.** Models change quotes in small, predictable ways: wrapping them in quote marks, adding an ellipsis at either end, adding a full stop, straightening an apostrophe. The check tolerates exactly those and rejects everything else, including two fragments joined with "...". Matching on whole words matters too: without it, "rice went up" would match "the price went up".

**Next time.** Track the share of rejected quotes as a score from the start. It is already stored on every summary, and it is the most direct measure of how much the summary can be trusted.

## pnpm workspaces

**What it does.** One repo with several packages. `workspace:*` links `packages/shared` into both apps, `pnpm --filter` runs a script in one package, and `pnpm -r --parallel` runs it in all of them.

**Surprises.**

- pnpm 10 does not run dependencies' install scripts unless you allow them (`onlyBuiltDependencies` in `pnpm-workspace.yaml`).
- The apps import the shared package's built output, so it has to be built before the apps typecheck or test. The root scripts build it first.

**Next time.** Let the apps read the shared package's TypeScript source directly (an exports condition, or TypeScript project references) so there is no build step to remember.

## LangGraph

**What it does.** Runs an LLM workflow as a graph. Nodes are functions that read the state and return an update, edges (fixed or conditional) decide what runs next, and a checkpointer saves the state after every step so a run can pause, survive a restart and resume. The moderator is one graph per interview, with the interview id as the `thread_id`.

**Idiomatic vs by hand.** By hand this is a state machine in a service: a `step` field on the interview, a `switch` on it for every message, and code to rebuild where you were after a restart. In LangGraph:

- The flow is declared once with `addNode`, `addEdge` and `addConditionalEdges`. The router after `decide` is a plain function (`routeAfterDecide`), so the follow-up cap is a unit test, not a hope about the prompt.
- The state is declared with `new StateSchema({ ... })` and zod fields. By default a node's return value replaces a field; wrapping the turns in `new ReducedValue(schema, { reducer: (current, next) => [...current, ...next] })` makes them append instead.
- Waiting for the respondent is one line in a node: `interrupt<AwaitingAnswer, AnswerResume>({ questionKey, followUpIndex })`. The graph saves a checkpoint and stops. The next answer resumes it with `graph.stream(new Command({ resume: { messageId, text } }), config)`, and `interrupt()` returns that value inside the node.
- `graph.getState(config)` tells the service what the graph is waiting for (`tasks[].interrupts`) and whether it has finished (`next` is empty), so the service never keeps its own copy of where the conversation is.

**Surprises.**

- When a graph resumes, the interrupted node runs again from the top, and `interrupt()` returns the resume value the second time. Anything written before the `interrupt()` call runs twice. The `awaitAnswer` node therefore does nothing but interrupt, and saving messages happens outside the graph.
- `streamMode: ['messages', 'updates']` gives `[mode, chunk]` pairs: token chunks from every model call, and each node's state update when it finishes. "Every model call" includes `decide`, whose structured JSON would have streamed straight into the chat. Each token chunk carries `metadata.langgraph_node`, and only the three speaking nodes are forwarded.
- A node can call `chain.invoke()` and the tokens still stream. When the graph runs in `messages` mode, LangGraph's callback handler asks the model to stream internally, so nodes do not need their own streaming code.
- With extended thinking, a message's `content` is a list of blocks that includes the thinking. `message.text` returns only the text blocks, which is what the respondent should see.
- The MongoDB checkpointer is typed against MongoDB driver 6, and Mongoose 9 brings driver 7. It only uses `db().collection()` methods, which both versions share, so it reuses Mongoose's connection through a cast instead of opening a second pool.
- Most examples online use the older `Annotation.Root` API. The 1.x `StateSchema` with zod reads better and validates the input, but searching for help mostly finds the old style.

**Next time.** The graph state keeps every turn's text, and the `messages` collection keeps it again. The graph only needs the current question's turns to decide, so next time its state would hold ids and counters and read the text from `messages`. One source of truth, and smaller checkpoints.

## Socket.io

**What it does.** Two-way events between browser and server over a WebSocket (with HTTP long polling as a fallback), plus reconnection, acknowledgements, namespaces and rooms.

**Idiomatic vs by hand.** By hand you write `io.of('/interview').on('connection', (socket) => socket.on('interview:answer', async (body, ack) => { ... }))` and call `ack` yourself. In Nest a gateway is a provider like a service:

- `@WebSocketGateway({ namespace: '/interview' })` on the class, `@SubscribeMessage('interview:answer')` on a method, `@MessageBody()` and `@ConnectedSocket()` on its parameters.
- Whatever the method returns is sent back as the acknowledgement, so the browser can `await socket.emitWithAck('interview:answer', payload)` like an HTTP call.
- `@WebSocketServer()` gives the namespace for pushing events, and `server.to(interviewId).emit(...)` reaches every tab in the interview's room. `socket.to(room)` reaches everyone in the room except the sender.
- The event names and payloads are typed once in the shared package (`ClientToServerEvents`, `ServerToClientEvents`), and both the gateway and the React hook use them. A typo in an event name or a wrong payload fails the typecheck on both sides.
- The interview service does not know about sockets. It talks back through a small `InterviewEmitter` interface that the gateway implements, which keeps the service easy to test.

**Surprises.**

- The type parameters flip between sides: the browser's socket is `Socket<ServerToClientEvents, ClientToServerEvents>` (what it listens to, then what it emits), and the server's is the other way round.
- An exception thrown in a gateway handler does not turn into an acknowledgement. Nest's WebSocket exception filter emits a separate `exception` event instead, so a browser awaiting `emitWithAck` would wait forever. And only a `WsException` keeps its message: a `NotFoundException` from a shared service arrives as "Internal server error". The handlers here validate with zod's `safeParse`, catch errors, and always return an `Ack` union (`{ ok: true, data }` or `{ ok: false, error }`). The browser also uses `socket.timeout(10_000).emitWithAck(...)` so a lost acknowledgement becomes an error it can show.
- The answer handler acknowledges as soon as the answer is saved, and the moderator's reply follows as events. Holding the acknowledgement until Claude finished would have run into that 10 second timeout.
- The Vite dev proxy needs `ws: true` on `/socket.io`, or the WebSocket upgrade is not forwarded.
- React's StrictMode runs effects twice in development, so every page load opened two sockets that joined at the same moment. The unique index on `{ studyId, respondentId }` lets only one of them create the interview, and the other picks it up.

**Next time.** Deltas are fire and forget. If the socket reconnects in the middle of a reply, the streaming text has a gap until `moderator:done` replaces it with the saved message. Sending the whole reply so far with each event, rather than only the new piece, would remove the gap and costs almost nothing at chat sizes.

## PostHog

**What it does.** Product analytics (events, funnels, persons, groups) and feature flags in one tool. posthog-js runs in the browser and posthog-node on the server.

**Idiomatic vs by hand.** By hand you would write events to your own table, build funnels in SQL, and hash user ids into buckets for an A/B test. With PostHog:

- The browser owns the person. posthog-js creates a distinct id, and the web app sends it to the API in a header on REST calls and in the Socket.io handshake. Server events use the same id, so the browser's `brief_submitted` and the server's `study_launched` land on the same person.
- Steps that change data are captured on the server, where ad blockers cannot drop them and the event fires only if the change really happened.
- `groups: { study: studyId }` on the server and `$groups` on the browser tag every event with its study, so a funnel can be counted per study as well as per person.
- The moderator prompt version comes from a multivariate flag: `evaluateFlags(distinctId, { flagKeys: [...] })`, then `flags.getFlag(key)`. It is read once, when the interview is created, and stored on the interview so the prompt cannot change halfway through a conversation. The interview events carry `$feature/moderator-prompt-version`, which is the property PostHog uses to break a funnel down by variant.

**Surprises.**

- `getFeatureFlag()` still works in posthog-node 5 but is deprecated. `evaluateFlags()` fetches several flags in one request and returns an object to read them from.
- Reading a flag sends a `$feature_flag_called` event automatically. That is the exposure event PostHog experiments count, so it is worth reading the flag only where the variant is actually used.
- Without a personal API key, posthog-node asks PostHog for the flag on each call instead of evaluating it locally. That is fine here, since it happens once per interview.
- `capture()` can take the flags snapshot (`{ flags }`) and attach the values itself. The interview events set `$feature/moderator-prompt-version` by hand instead, because `interview_completed` fires many requests later and must carry the version stored on the interview, not a fresh evaluation.
- posthog-node batches events in the background. The API calls `shutdown()` when Nest shuts down, or the last events would be lost.
- Vite only exposes environment variables with an allowed prefix to browser code. Rather than rename the variables or open a broad prefix, `envPrefix` lists the two PostHog names. The project key is public by design.
- posthog-js tips the web bundle over Vite's 500 kB warning. Fine for a demo; a real app would load it lazily.
- posthog-js drops events from browsers that look automated (`navigator.webdriver`, or "HeadlessChrome" in the user agent) without any warning. My first scripted end to end run sent all five server events and neither browser event, so the funnel had no first step. A Playwright run that should count needs a normal user agent and `webdriver` reported as false.

**Next time.** No test checks the analytics. The e2e tests would pass with every `capture` call deleted. Next time I would give the e2e tests a fake PostHog client and assert the funnel events, in order, for one full run.
