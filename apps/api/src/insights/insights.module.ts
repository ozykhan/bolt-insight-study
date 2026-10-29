import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { InterviewsModule } from '../interviews/interviews.module.js';
import { StudiesModule } from '../studies/studies.module.js';
import { InsightsChainFactory } from './insights-chain.factory.js';
import { InsightsSummary, InsightsSummarySchema } from './insights-summary.schema.js';
import { InsightsController } from './insights.controller.js';
import { InsightsService } from './insights.service.js';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: InsightsSummary.name, schema: InsightsSummarySchema }]),
    StudiesModule,
    InterviewsModule,
  ],
  controllers: [InsightsController],
  providers: [InsightsService, InsightsChainFactory],
})
export class InsightsModule {}
