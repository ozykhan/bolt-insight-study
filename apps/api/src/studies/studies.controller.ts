import { Body, Controller, Get, HttpCode, Param, Post, Put } from '@nestjs/common';
import { ParseObjectIdPipe } from '@nestjs/mongoose';
import { Throttle } from '@nestjs/throttler';
import type { Types } from 'mongoose';
import {
  ANALYTICS_EVENTS,
  CreateStudySchema,
  QuestionnaireUpdateSchema,
  type CreateStudyInput,
  type QuestionnaireUpdate,
  type StudyDetailDto,
  type StudyDto,
} from '@probe-lab/shared';
import { AnalyticsService } from '../analytics/analytics.service.js';
import { DistinctId } from '../analytics/distinct-id.decorator.js';
import { RATE_LIMITS } from '../common/rate-limits.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { StudiesService } from './studies.service.js';

/**
 * Controllers stay thin in Nest: they map HTTP to service calls, and pipes
 * (ParseObjectIdPipe, ZodValidationPipe) turn raw params and bodies into
 * typed, validated values before the handler runs. Funnel events are sent
 * here, after the service succeeds, because only the HTTP layer knows the
 * browser's distinct id.
 */
@Controller('studies')
export class StudiesController {
  constructor(
    private readonly studies: StudiesService,
    private readonly analytics: AnalyticsService,
  ) {}

  @Get()
  list(): Promise<StudyDto[]> {
    return this.studies.list();
  }

  @Post()
  @Throttle({ default: RATE_LIMITS.createStudy })
  create(
    @Body(new ZodValidationPipe(CreateStudySchema)) body: CreateStudyInput,
  ): Promise<StudyDetailDto> {
    return this.studies.create(body.brief);
  }

  @Get(':id')
  detail(@Param('id', ParseObjectIdPipe) id: Types.ObjectId): Promise<StudyDetailDto> {
    return this.studies.detail(id);
  }

  @Post(':id/questionnaire/generate')
  @HttpCode(200)
  @Throttle({ default: RATE_LIMITS.generateQuestionnaire })
  async generate(
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
    @DistinctId() distinctId: string | null,
  ): Promise<StudyDetailDto> {
    const detail = await this.studies.generateQuestionnaire(id);
    this.analytics.capture(distinctId, ANALYTICS_EVENTS.questionnaireGenerated, detail.study.id, {
      questionnaire_version: detail.questionnaire?.version,
      question_count: detail.questionnaire?.questions.length,
    });
    return detail;
  }

  @Put(':id/questionnaire')
  async updateQuestionnaire(
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
    @Body(new ZodValidationPipe(QuestionnaireUpdateSchema)) body: QuestionnaireUpdate,
    @DistinctId() distinctId: string | null,
  ): Promise<StudyDetailDto & { changed: boolean }> {
    const result = await this.studies.updateQuestionnaire(id, body);
    if (result.changed) {
      this.analytics.capture(distinctId, ANALYTICS_EVENTS.questionnaireEdited, result.study.id, {
        questionnaire_version: result.questionnaire?.version,
        question_count: result.questionnaire?.questions.length,
      });
    }
    return result;
  }

  @Post(':id/launch')
  @HttpCode(200)
  async launch(
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
    @DistinctId() distinctId: string | null,
  ): Promise<StudyDetailDto> {
    const detail = await this.studies.launch(id);
    this.analytics.capture(distinctId, ANALYTICS_EVENTS.studyLaunched, detail.study.id, {
      questionnaire_version: detail.questionnaire?.version,
      question_count: detail.questionnaire?.questions.length,
    });
    return detail;
  }
}
