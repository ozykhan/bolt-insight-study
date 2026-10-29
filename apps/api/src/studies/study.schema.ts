import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { STUDY_STATUSES, type StudyStatus } from '@probe-lab/shared';

/** There is no auth in this project; every study belongs to this client. */
export const DEMO_CLIENT_ID = 'demo-client';

@Schema({ collection: 'studies', timestamps: true })
export class Study {
  @Prop({ required: true, default: DEMO_CLIENT_ID })
  clientId: string;

  @Prop({ required: true })
  title: string;

  @Prop({ required: true })
  brief: string;

  @Prop({ type: String, required: true, enum: STUDY_STATUSES, default: 'draft' })
  status: StudyStatus;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Questionnaire', default: null })
  activeQuestionnaireId: Types.ObjectId | null;

  @Prop({ type: Date, default: null })
  launchedAt: Date | null;

  createdAt: Date;
  updatedAt: Date;
}

export type StudyDocument = HydratedDocument<Study>;
export const StudySchema = SchemaFactory.createForClass(Study);
StudySchema.index({ clientId: 1, createdAt: -1 });
