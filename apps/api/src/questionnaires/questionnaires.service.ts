import {
  BadGatewayException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  assignQuestionKeys,
  type Question,
  type QuestionnaireSource,
  type QuestionnaireUpdate,
} from '@probe-lab/shared';
import { LlmNotConfiguredError } from '../llm/chat-model.js';
import { ChatModelFactory, LangfuseService } from '../llm/llm.providers.js';
import { BRIEF_EXPANSION_PROMPT } from './brief-expansion.prompt.js';
import { createBriefExpansionChain } from './brief-expansion.chain.js';
import { Questionnaire, type QuestionnaireDocument } from './questionnaire.schema.js';

interface QuestionnaireContent {
  title: string;
  audience: string;
  topics: string[];
  questions: Question[];
}

interface GenerationMeta {
  promptSource?: string;
  model?: string;
  langfuseTraceId?: string;
}

@Injectable()
export class QuestionnairesService {
  private readonly logger = new Logger(QuestionnairesService.name);

  constructor(
    @InjectModel(Questionnaire.name) private readonly questionnaires: Model<Questionnaire>,
    private readonly models: ChatModelFactory,
    private readonly langfuse: LangfuseService,
  ) {}

  findById(id: Types.ObjectId | string): Promise<QuestionnaireDocument | null> {
    return this.questionnaires.findById(id).exec();
  }

  /** Expands a brief into a questionnaire with Claude and saves it as a new version. */
  async generate(study: {
    id: string;
    brief: string;
    clientId: string;
  }): Promise<QuestionnaireDocument> {
    const prompt = await this.langfuse.loadPrompt(BRIEF_EXPANSION_PROMPT);
    const handler = this.langfuse.handler({
      sessionId: `study-${study.id}`,
      userId: study.clientId,
      tags: ['brief-expansion', prompt.source],
      metadata: { studyId: study.id },
    });

    let draft;
    try {
      const chain = createBriefExpansionChain(
        prompt.template,
        this.models.create({ effort: 'medium' }),
      );
      draft = await chain.invoke(
        { brief: study.brief },
        { callbacks: [handler], runName: 'brief-expansion' },
      );
    } catch (error) {
      if (error instanceof LlmNotConfiguredError) {
        throw new ServiceUnavailableException(error.message);
      }
      this.logger.error(`Brief expansion failed for study ${study.id}`, error);
      throw new BadGatewayException('The model could not draft a questionnaire. Try again.');
    }

    return this.saveVersion(
      study.id,
      { ...draft, questions: assignQuestionKeys(draft.questions) },
      'generated',
      {
        promptSource: prompt.source,
        model: this.models.modelName,
        langfuseTraceId: handler.last_trace_id ?? undefined,
      },
    );
  }

  /**
   * Saves the client's edits as a new version. Saving without changes keeps
   * the current version, so `changed` tells the caller whether anything was
   * really edited.
   */
  async saveEdit(
    studyId: string,
    current: QuestionnaireDocument | null,
    update: QuestionnaireUpdate,
  ): Promise<{ questionnaire: QuestionnaireDocument; changed: boolean }> {
    const next: QuestionnaireContent = {
      title: update.title,
      audience: update.audience,
      topics: update.topics,
      questions: assignQuestionKeys(update.questions),
    };
    if (current && sameContent(current, next)) {
      return { questionnaire: current, changed: false };
    }
    const questionnaire = await this.saveVersion(studyId, next, 'edited');
    return { questionnaire, changed: true };
  }

  private async saveVersion(
    studyId: string,
    content: QuestionnaireContent,
    source: QuestionnaireSource,
    meta: GenerationMeta = {},
  ): Promise<QuestionnaireDocument> {
    const latest = await this.questionnaires
      .findOne({ studyId })
      .sort({ version: -1 })
      .select('version')
      .lean()
      .exec();
    return this.questionnaires.create({
      studyId: new Types.ObjectId(studyId),
      version: (latest?.version ?? 0) + 1,
      source,
      ...content,
      ...meta,
    });
  }
}

function sameContent(doc: QuestionnaireDocument, next: QuestionnaireContent): boolean {
  const current: QuestionnaireContent = {
    title: doc.title,
    audience: doc.audience,
    topics: [...doc.topics],
    questions: doc.questions.map(({ key, text, goal }) => ({ key, text, goal })),
  };
  return JSON.stringify(current) === JSON.stringify(next);
}
