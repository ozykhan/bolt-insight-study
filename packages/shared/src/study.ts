import { z } from 'zod';
import type { Question } from './questionnaire.js';

export const STUDY_STATUSES = ['draft', 'live', 'closed'] as const;
export type StudyStatus = (typeof STUDY_STATUSES)[number];

export const QUESTIONNAIRE_SOURCES = ['generated', 'edited'] as const;
export type QuestionnaireSource = (typeof QUESTIONNAIRE_SOURCES)[number];

/** Body of `POST /studies`. */
export const CreateStudySchema = z.object({
  brief: z.string().trim().min(15).max(2000),
});
export type CreateStudyInput = z.infer<typeof CreateStudySchema>;

export interface StudyDto {
  id: string;
  title: string;
  brief: string;
  status: StudyStatus;
  activeQuestionnaireId: string | null;
  createdAt: string;
  launchedAt: string | null;
}

export interface QuestionnaireDto {
  id: string;
  studyId: string;
  version: number;
  source: QuestionnaireSource;
  title: string;
  audience: string;
  topics: string[];
  questions: Question[];
  createdAt: string;
}

export interface StudyDetailDto {
  study: StudyDto;
  questionnaire: QuestionnaireDto | null;
}
