// Must stay the first import: it loads .env and registers Langfuse's span
// processor before any LangChain code creates a span.
import './instrumentation.js';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { CorsIoAdapter } from './common/cors-io.adapter.js';
import type { Env } from './config/env.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get<ConfigService<Env, true>>(ConfigService);
  const origins = config.get('WEB_ORIGIN', { infer: true });

  app.setGlobalPrefix('api');
  // In production the web app is on another origin (Vercel), so the browser
  // needs CORS headers for REST calls and for Socket.io's polling transport.
  // CORS only binds browsers; the rate limits are what slow down scripts.
  app.enableCors({ origin: origins });
  app.useWebSocketAdapter(new CorsIoAdapter(app, origins));
  // Runs onApplicationShutdown hooks on Ctrl+C, and on the SIGTERM a host
  // sends before replacing a deploy, which flushes pending traces and events.
  app.enableShutdownHooks();

  const port = config.get('PORT', { infer: true }) ?? config.get('API_PORT', { infer: true });
  await app.listen(port);
  Logger.log(`API listening on http://localhost:${port}/api`, 'Bootstrap');
}
await bootstrap();
