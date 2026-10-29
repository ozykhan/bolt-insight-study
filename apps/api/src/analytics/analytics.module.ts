import { Global, Module } from '@nestjs/common';
import { AnalyticsService } from './analytics.service.js';

/** Global like the LLM module: any feature module can inject AnalyticsService. */
@Global()
@Module({
  providers: [AnalyticsService],
  exports: [AnalyticsService],
})
export class AnalyticsModule {}
