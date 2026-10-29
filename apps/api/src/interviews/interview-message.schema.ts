import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import {
  MESSAGE_KINDS,
  MESSAGE_ROLES,
  type MessageKind,
  type MessageRole,
} from '@probe-lab/shared';

/**
 * Everything said in an interview, one document per message. This is the
 * single source of truth for what respondents said: the insights summary
 * quotes answers by their `_id`. Messages get their own collection instead of
 * being embedded in the interview because they grow with every turn and
 * other documents point at single answers.
 */
@Schema({ collection: 'messages', timestamps: { createdAt: true, updatedAt: false } })
export class InterviewMessage {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Interview', required: true })
  interviewId: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Study', required: true })
  studyId: Types.ObjectId;

  @Prop({ required: true })
  seq: number;

  @Prop({ type: String, required: true, enum: MESSAGE_ROLES })
  role: MessageRole;

  @Prop({ type: String, required: true, enum: MESSAGE_KINDS })
  kind: MessageKind;

  @Prop({ type: String, default: null })
  questionKey: string | null;

  @Prop({ required: true, default: 0 })
  followUpIndex: number;

  @Prop({ required: true })
  content: string;

  createdAt: Date;
}

export type InterviewMessageDocument = HydratedDocument<InterviewMessage>;
export const InterviewMessageSchema = SchemaFactory.createForClass(InterviewMessage);
InterviewMessageSchema.index({ interviewId: 1, seq: 1 }, { unique: true });
// For the insights summary: every respondent answer in a study.
InterviewMessageSchema.index({ studyId: 1, role: 1 });
