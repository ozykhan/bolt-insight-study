import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { AnalyticsModule } from './analytics/analytics.module.js';
import { validateEnv, type Env } from './config/env.js';
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
        serverSelectionTimeoutMS: 5_000,
      }),
    }),
    LlmModule,
    AnalyticsModule,
    StudiesModule,
    InterviewsModule,
    InsightsModule,
  ],
})
export class AppModule {}
