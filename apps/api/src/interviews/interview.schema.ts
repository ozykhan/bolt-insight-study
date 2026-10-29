import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import {
  INTERVIEW_STATUSES,
  PROMPT_VERSIONS,
  type InterviewStatus,
  type PromptVersion,
} from '@probe-lab/shared';

/**
 * One respondent's interview. Its id doubles as the LangGraph thread id (the
 * checkpointer stores the moderator's state under it) and as the Langfuse
 * session id, so one interview reads as one session with a trace per turn.
 */
@Schema({ collection: 'interviews', timestamps: { createdAt: 'startedAt', updatedAt: false } })
export class Interview {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Study', required: true })
  studyId: Types.ObjectId;

  /** The exact questionnaire version this interview follows. */
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Questionnaire', required: true })
  questionnaireId: Types.ObjectId;

  /** The respondent's PostHog distinct id. Respondents are anonymous. */
  @Prop({ required: true })
  respondentId: string;

  /** From the PostHog flag, read once at the start. */
  @Prop({ type: String, required: true, enum: PROMPT_VERSIONS })
  promptVersion: PromptVersion;

  @Prop({ type: String, required: true, enum: INTERVIEW_STATUSES, default: 'in_progress' })
  status: InterviewStatus;

  @Prop({ type: Date, default: null })
  completedAt: Date | null;

  startedAt: Date;
}

export type InterviewDocument = HydratedDocument<Interview>;
export const InterviewSchema = SchemaFactory.createForClass(Interview);
// One interview per respondent per study: reopening the link resumes it.
InterviewSchema.index({ studyId: 1, respondentId: 1 }, { unique: true });
