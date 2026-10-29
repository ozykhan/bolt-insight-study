import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import type { RejectReason } from './quote-check.js';

@Schema({ _id: false })
export class SummaryQuote {
  /** The respondent message this quote was cut from. */
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'InterviewMessage', required: true })
  messageId: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Interview', required: true })
  interviewId: Types.ObjectId;

  @Prop({ type: String, default: null })
  questionKey: string | null;

  /** Exactly as it appears in the message. */
  @Prop({ required: true })
  text: string;
}
const SummaryQuoteSchema = SchemaFactory.createForClass(SummaryQuote);

@Schema({ _id: false })
export class SummaryTheme {
  @Prop({ required: true })
  title: string;

  @Prop({ required: true })
  summary: string;

  @Prop({ type: [SummaryQuoteSchema], required: true })
  quotes: SummaryQuote[];
}
const SummaryThemeSchema = SchemaFactory.createForClass(SummaryTheme);

/** A quote the model returned that did not check out, kept to see how often that happens. */
@Schema({ _id: false })
export class RejectedSummaryQuote {
  @Prop({ required: true })
  ref: string;

  @Prop({ required: true })
  text: string;

  @Prop({ type: String, required: true })
  reason: RejectReason;
}
const RejectedSummaryQuoteSchema = SchemaFactory.createForClass(RejectedSummaryQuote);

/**
 * One generated insights summary. Each generation is a new document, like
 * questionnaire versions, so an earlier summary is never overwritten.
 * Quotes point at messages by id; the question text and the full answer are
 * read from the messages when the summary is shown.
 */
@Schema({ collection: 'summaries', timestamps: { createdAt: true, updatedAt: false } })
export class InsightsSummary {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Study', required: true })
  studyId: Types.ObjectId;

  @Prop({ required: true })
  overview: string;

  @Prop({ type: [SummaryThemeSchema], required: true })
  themes: SummaryTheme[];

  @Prop({ type: [RejectedSummaryQuoteSchema], default: [] })
  rejectedQuotes: RejectedSummaryQuote[];

  @Prop({ required: true })
  interviewCount: number;

  @Prop({ required: true })
  answerCount: number;

  @Prop({ required: true })
  promptSource: string;

  @Prop()
  model?: string;

  @Prop()
  langfuseTraceId?: string;

  createdAt: Date;
}

export type InsightsSummaryDocument = HydratedDocument<InsightsSummary>;
export const InsightsSummarySchema = SchemaFactory.createForClass(InsightsSummary);
InsightsSummarySchema.index({ studyId: 1, createdAt: -1 });
