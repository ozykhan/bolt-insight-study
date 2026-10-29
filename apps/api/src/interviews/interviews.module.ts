import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { QuestionnairesModule } from '../questionnaires/questionnaires.module.js';
import { StudiesModule } from '../studies/studies.module.js';
import { InterviewMessage, InterviewMessageSchema } from './interview-message.schema.js';
import { Interview, InterviewSchema } from './interview.schema.js';
import { InterviewsGateway } from './interviews.gateway.js';
import { InterviewsService } from './interviews.service.js';
import { ModeratorChainsFactory } from './moderator-chains.factory.js';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Interview.name, schema: InterviewSchema },
      { name: InterviewMessage.name, schema: InterviewMessageSchema },
    ]),
    StudiesModule,
    QuestionnairesModule,
  ],
  providers: [InterviewsService, InterviewsGateway, ModeratorChainsFactory],
})
export class InterviewsModule {}
