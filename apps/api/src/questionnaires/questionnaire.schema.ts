import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { QUESTIONNAIRE_SOURCES, type QuestionnaireSource } from '@probe-lab/shared';

@Schema({ _id: false })
export class QuestionItem {
  @Prop({ required: true })
  key: string;

  @Prop({ required: true })
  text: string;

  @Prop({ required: true })
  goal: string;
}
const QuestionItemSchema = SchemaFactory.createForClass(QuestionItem);

/**
 * One version of a study's questionnaire. Every save creates a new document,
 * so the generated original stays next to the client's edits. Questions are
 * embedded because the editor always reads and writes the whole list.
 */
@Schema({ collection: 'questionnaires', timestamps: { createdAt: true, updatedAt: false } })
export class Questionnaire {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Study', required: true })
  studyId: Types.ObjectId;

  @Prop({ required: true })
  version: number;

  @Prop({ type: String, required: true, enum: QUESTIONNAIRE_SOURCES })
  source: QuestionnaireSource;

  @Prop({ required: true })
  title: string;

  @Prop({ required: true })
  audience: string;

  @Prop({ type: [String], default: [] })
  topics: string[];

  @Prop({ type: [QuestionItemSchema], required: true })
  questions: QuestionItem[];

  /** Which prompt produced a generated version, for example `langfuse:3` or `repo:v1`. */
  @Prop()
  promptSource?: string;

  @Prop()
  model?: string;

  @Prop()
  langfuseTraceId?: string;

  createdAt: Date;
}

export type QuestionnaireDocument = HydratedDocument<Questionnaire>;
export const QuestionnaireSchema = SchemaFactory.createForClass(Questionnaire);
QuestionnaireSchema.index({ studyId: 1, version: -1 }, { unique: true });
