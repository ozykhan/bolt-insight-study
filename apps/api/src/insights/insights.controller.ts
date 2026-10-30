import { Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { ParseObjectIdPipe } from '@nestjs/mongoose';
import { Throttle } from '@nestjs/throttler';
import type { Types } from 'mongoose';
import type { StudyInsightsDto } from '@probe-lab/shared';
import { RATE_LIMITS } from '../common/rate-limits.js';
import { InsightsService } from './insights.service.js';

@Controller('studies/:id/insights')
export class InsightsController {
  constructor(private readonly insights: InsightsService) {}

  @Get()
  get(@Param('id', ParseObjectIdPipe) id: Types.ObjectId): Promise<StudyInsightsDto> {
    return this.insights.forStudy(id);
  }

  /** Writes a new summary from every completed interview (20 to 60 seconds). */
  @Post()
  @HttpCode(200)
  @Throttle({ default: RATE_LIMITS.generateInsights })
  generate(@Param('id', ParseObjectIdPipe) id: Types.ObjectId): Promise<StudyInsightsDto> {
    return this.insights.generate(id);
  }
}
