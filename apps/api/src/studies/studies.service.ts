import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import type { QuestionnaireUpdate, StudyDetailDto, StudyDto } from '@probe-lab/shared';
import { QuestionnairesService } from '../questionnaires/questionnaires.service.js';
import { DEMO_CLIENT_ID, Study, type StudyDocument } from './study.schema.js';
import { toQuestionnaireDto, toStudyDto } from './study.mapper.js';

@Injectable()
export class StudiesService {
  constructor(
    @InjectModel(Study.name) private readonly studies: Model<Study>,
    private readonly questionnaires: QuestionnairesService,
  ) {}

  async list(): Promise<StudyDto[]> {
    const studies = await this.studies
      .find({ clientId: DEMO_CLIENT_ID })
      .sort({ createdAt: -1 })
      .exec();
    return studies.map(toStudyDto);
  }

  /** Saves the brief as a draft study. Generating the questionnaire is a separate call. */
  async create(brief: string): Promise<StudyDetailDto> {
    const study = await this.studies.create({ brief, title: provisionalTitle(brief) });
    return { study: toStudyDto(study), questionnaire: null };
  }

  async detail(id: Types.ObjectId): Promise<StudyDetailDto> {
    return this.toDetail(await this.findOrThrow(id));
  }

  async generateQuestionnaire(id: Types.ObjectId): Promise<StudyDetailDto> {
    const study = await this.findDraftOrThrow(id);
    const questionnaire = await this.questionnaires.generate({
      id: study.id,
      brief: study.brief,
      clientId: study.clientId,
    });
    study.title = questionnaire.title;
    study.activeQuestionnaireId = questionnaire._id;
    await study.save();
    return { study: toStudyDto(study), questionnaire: toQuestionnaireDto(questionnaire) };
  }

  async updateQuestionnaire(
    id: Types.ObjectId,
    update: QuestionnaireUpdate,
  ): Promise<StudyDetailDto & { changed: boolean }> {
    const study = await this.findDraftOrThrow(id);
    const current = study.activeQuestionnaireId
      ? await this.questionnaires.findById(study.activeQuestionnaireId)
      : null;
    const { questionnaire, changed } = await this.questionnaires.saveEdit(study.id, current, update);
    if (changed) {
      study.title = questionnaire.title;
      study.activeQuestionnaireId = questionnaire._id;
      await study.save();
    }
    return { study: toStudyDto(study), questionnaire: toQuestionnaireDto(questionnaire), changed };
  }

  /** Freezes the active questionnaire version and opens the study to respondents. */
  async launch(id: Types.ObjectId): Promise<StudyDetailDto> {
    const study = await this.findDraftOrThrow(id);
    if (!study.activeQuestionnaireId) {
      throw new ConflictException('Generate a questionnaire before launching the study.');
    }
    study.status = 'live';
    study.launchedAt = new Date();
    await study.save();
    return this.toDetail(study);
  }

  private async findOrThrow(id: Types.ObjectId): Promise<StudyDocument> {
    const study = await this.studies.findOne({ _id: id, clientId: DEMO_CLIENT_ID }).exec();
    if (!study) {
      throw new NotFoundException('Study not found');
    }
    return study;
  }

  private async findDraftOrThrow(id: Types.ObjectId): Promise<StudyDocument> {
    const study = await this.findOrThrow(id);
    if (study.status !== 'draft') {
      throw new ConflictException('This study is already live, so its questionnaire is locked.');
    }
    return study;
  }

  private async toDetail(study: StudyDocument): Promise<StudyDetailDto> {
    const questionnaire = study.activeQuestionnaireId
      ? await this.questionnaires.findById(study.activeQuestionnaireId)
      : null;
    return {
      study: toStudyDto(study),
      questionnaire: questionnaire ? toQuestionnaireDto(questionnaire) : null,
    };
  }
}

/** Placeholder title until the model suggests one: the brief's first few words. */
function provisionalTitle(brief: string): string {
  const words = brief.split(/\s+/).slice(0, 8).join(' ');
  return words.length < brief.length ? `${words}...` : words;
}
