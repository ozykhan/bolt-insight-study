import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { MongooseModule } from '@nestjs/mongoose';
import { ThrottlerModule } from '@nestjs/throttler';
import type { Request } from 'express';
import { AnalyticsModule } from './analytics/analytics.module.js';
import { clientIp } from './common/client-ip.js';
import { HttpThrottlerGuard } from './common/http-throttler.guard.js';
import { RATE_LIMITS } from './common/rate-limits.js';
import { validateEnv, type Env } from './config/env.js';
import { HealthModule } from './health/health.module.js';
import { InsightsModule } from './insights/insights.module.js';
import { InterviewsModule } from './interviews/interviews.module.js';
import { LlmModule } from './llm/llm.module.js';
import { StudiesModule } from './studies/studies.module.js';

@Module({
  imports: [
    // load-env.ts already put the root .env into process.env; ConfigModule
    // only validates it and makes it injectable as ConfigService.
    ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true, validate: validateEnv }),
    // forRootAsync lets the connection wait for config instead of reading
    // process.env at import time.
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        uri: config.get('MONGODB_URI', { infer: true }),
        dbName: config.get('MONGODB_DB_NAME', { infer: true }),
        serverSelectionTimeoutMS: 5_000,
      }),
    }),
    // Counts requests per client IP in memory, which is right for the one API
    // instance this runs as. Several instances would share a Redis store.
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        throttlers: [RATE_LIMITS.default],
        errorMessage: 'Too many requests from your network. Wait a few minutes and try again.',
        getTracker: (req) => {
          const { headers, socket } = req as Request;
          return clientIp(headers, socket.remoteAddress, config.get('CLIENT_IP_HEADER', { infer: true }));
        },
      }),
    }),
    LlmModule,
    AnalyticsModule,
    StudiesModule,
    InterviewsModule,
    InsightsModule,
    HealthModule,
  ],
  // APP_GUARD registers the guard for every route in the app, and @Throttle()
  // on a route swaps in that route's own limit.
  providers: [{ provide: APP_GUARD, useClass: HttpThrottlerGuard }],
})
export class AppModule {}
