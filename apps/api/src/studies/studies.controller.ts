import { Body, Controller, Get, HttpCode, Param, Post, Put } from '@nestjs/common';
import { ParseObjectIdPipe } from '@nestjs/mongoose';
import type { Types } from 'mongoose';
import {
  CreateStudySchema,
  QuestionnaireUpdateSchema,
  type CreateStudyInput,
  type QuestionnaireUpdate,
  type StudyDetailDto,
  type StudyDto,
} from '@probe-lab/shared';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { StudiesService } from './studies.service.js';

/**
 * Controllers stay thin in Nest: they map HTTP to service calls, and pipes
 * (ParseObjectIdPipe, ZodValidationPipe) turn raw params and bodies into
 * typed, validated values before the handler runs.
 */
@Controller('studies')
export class StudiesController {
  constructor(private readonly studies: StudiesService) {}

  @Get()
  list(): Promise<StudyDto[]> {
    return this.studies.list();
  }

  @Post()
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
  generate(@Param('id', ParseObjectIdPipe) id: Types.ObjectId): Promise<StudyDetailDto> {
    return this.studies.generateQuestionnaire(id);
  }

  @Put(':id/questionnaire')
  updateQuestionnaire(
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
    @Body(new ZodValidationPipe(QuestionnaireUpdateSchema)) body: QuestionnaireUpdate,
  ): Promise<StudyDetailDto & { changed: boolean }> {
    return this.studies.updateQuestionnaire(id, body);
  }

  @Post(':id/launch')
  @HttpCode(200)
  launch(@Param('id', ParseObjectIdPipe) id: Types.ObjectId): Promise<StudyDetailDto> {
    return this.studies.launch(id);
  }
}
