import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Questionnaire, QuestionnaireSchema } from './questionnaire.schema.js';
import { QuestionnairesService } from './questionnaires.service.js';

@Module({
  imports: [MongooseModule.forFeature([{ name: Questionnaire.name, schema: QuestionnaireSchema }])],
  providers: [QuestionnairesService],
  exports: [QuestionnairesService],
})
export class QuestionnairesModule {}
