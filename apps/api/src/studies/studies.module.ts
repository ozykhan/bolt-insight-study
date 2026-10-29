import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { QuestionnairesModule } from '../questionnaires/questionnaires.module.js';
import { StudiesController } from './studies.controller.js';
import { StudiesService } from './studies.service.js';
import { Study, StudySchema } from './study.schema.js';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Study.name, schema: StudySchema }]),
    QuestionnairesModule,
  ],
  controllers: [StudiesController],
  providers: [StudiesService],
  exports: [StudiesService],
})
export class StudiesModule {}
