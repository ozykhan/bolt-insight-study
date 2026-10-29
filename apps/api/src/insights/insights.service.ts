import {
  BadGatewayException,
  ConflictException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import type {
  InsightsDraft,
  InsightsSummaryDto,
  QuestionnaireDto,
  StudyInsightsDto,
} from '@probe-lab/shared';
import { InterviewsService } from '../interviews/interviews.service.js';
import { LlmNotConfiguredError } from '../llm/chat-model.js';
import { ChatModelFactory, LangfuseService } from '../llm/llm.providers.js';
import { StudiesService } from '../studies/studies.service.js';
import { InsightsChainFactory } from './insights-chain.factory.js';
import { InsightsSummary, type InsightsSummaryDocument } from './insights-summary.schema.js';
import { checkDraft } from './quote-check.js';
import { formatAnswers } from './transcripts.js';

@Injectable()
export class InsightsService {
  private readonly logger = new Logger(InsightsService.name);

  constructor(
    @InjectModel(InsightsSummary.name) private readonly summaries: Model<InsightsSummary>,
    private readonly studies: StudiesService,
    private readonly interviews: InterviewsService,
    private readonly chains: InsightsChainFactory,
    private readonly models: ChatModelFactory,
    private readonly langfuse: LangfuseService,
  ) {}

  /** Interview counts and the latest summary, if there is one. */
  async forStudy(studyId: Types.ObjectId): Promise<StudyInsightsDto> {
    const { study, questionnaire } = await this.studies.detail(studyId);
    const [counts, latest] = await Promise.all([
      this.interviews.countsForStudy(study.id),
      this.summaries.findOne({ studyId }).sort({ createdAt: -1 }).exec(),
    ]);
    return {
      studyId: study.id,
      interviews: counts,
      summary: latest ? await this.toDto(latest, questionnaire) : null,
    };
  }

  /**
   * Summarises every completed interview with Claude, then checks each quote
   * against the answer it cites. Quotes that do not match are dropped and
   * counted, so what the client sees can always be traced to a real answer.
   */
  async generate(studyId: Types.ObjectId): Promise<StudyInsightsDto> {
    const { study, questionnaire } = await this.studies.detail(studyId);
    if (study.status === 'draft' || !questionnaire) {
      throw new ConflictException('Launch the study and complete some interviews first.');
    }
    const transcripts = await this.interviews.completedTranscripts(study.id);
    const { text, answers } = formatAnswers(questionnaire.questions, transcripts);
    if (answers.size === 0) {
      throw new ConflictException('No interviews are completed yet, so there is nothing to summarise.');
    }

    const handler = this.langfuse.handler({
      sessionId: `study-${study.id}`,
      tags: ['insights'],
      metadata: { studyId: study.id, interviewCount: transcripts.length },
    });
    let draft: InsightsDraft;
    let promptSource: string;
    try {
      const loaded = await this.chains.create();
      promptSource = loaded.promptSource;
      draft = await loaded.chain.invoke(
        {
          studyTitle: study.title,
          brief: study.brief,
          interviewCount: transcripts.length,
          answers: text,
        },
        { callbacks: [handler], runName: 'insights-summary', tags: [promptSource] },
      );
    } catch (error) {
      if (error instanceof LlmNotConfiguredError) {
        throw new ServiceUnavailableException(error.message);
      }
      this.logger.error(`Insights summary failed for study ${study.id}`, error);
      throw new BadGatewayException('The model could not write a summary. Try again.');
    }

    const checked = checkDraft(draft, answers);
    if (checked.rejected.length > 0) {
      this.logger.warn(
        `Dropped ${checked.rejected.length} quote(s) that did not match an answer: ` +
          checked.rejected.map((q) => `${q.ref} (${q.reason})`).join(', '),
      );
    }
    if (checked.themes.length === 0) {
      throw new BadGatewayException('None of the quotes in the summary matched a real answer. Try again.');
    }

    const summary = await this.summaries.create({
      studyId,
      overview: checked.overview,
      themes: checked.themes.map((theme) => ({
        title: theme.title,
        summary: theme.summary,
        quotes: theme.quotes.map((quote) => ({
          messageId: new Types.ObjectId(quote.answer.messageId),
          interviewId: new Types.ObjectId(quote.answer.interviewId),
          questionKey: quote.answer.questionKey,
          text: quote.text,
        })),
      })),
      rejectedQuotes: checked.rejected,
      interviewCount: transcripts.length,
      answerCount: answers.size,
      promptSource,
      model: this.models.modelName,
      langfuseTraceId: handler.last_trace_id ?? undefined,
    });

    return {
      studyId: study.id,
      interviews: await this.interviews.countsForStudy(study.id),
      summary: await this.toDto(summary, questionnaire),
    };
  }

  /** Joins each quote with the full answer and the question it answered. */
  private async toDto(
    summary: InsightsSummaryDocument,
    questionnaire: QuestionnaireDto | null,
  ): Promise<InsightsSummaryDto> {
    const ids = summary.themes.flatMap((theme) => theme.quotes.map((quote) => quote.messageId));
    const messages = new Map(
      (await this.interviews.findMessages(ids)).map((message) => [message.id, message]),
    );
    const questions = new Map(questionnaire?.questions.map((q) => [q.key, q.text]));

    return {
      id: summary.id,
      overview: summary.overview,
      themes: summary.themes.map((theme) => ({
        title: theme.title,
        summary: theme.summary,
        quotes: theme.quotes.map((quote) => ({
          messageId: quote.messageId.toString(),
          interviewId: quote.interviewId.toString(),
          questionKey: quote.questionKey,
          question: questions.get(quote.questionKey ?? '') ?? null,
          text: quote.text,
          answer: messages.get(quote.messageId.toString())?.content ?? quote.text,
        })),
      })),
      interviewCount: summary.interviewCount,
      answerCount: summary.answerCount,
      rejectedQuoteCount: summary.rejectedQuotes.length,
      promptSource: summary.promptSource,
      createdAt: summary.createdAt.toISOString(),
    };
  }
}
