import type { QuestionnaireDto, StudyDto } from '@probe-lab/shared';
import type { QuestionnaireDocument } from '../questionnaires/questionnaire.schema.js';
import type { StudyDocument } from './study.schema.js';

export function toStudyDto(study: StudyDocument): StudyDto {
  return {
    id: study.id,
    title: study.title,
    brief: study.brief,
    status: study.status,
    activeQuestionnaireId: study.activeQuestionnaireId?.toString() ?? null,
    createdAt: study.createdAt.toISOString(),
    launchedAt: study.launchedAt?.toISOString() ?? null,
  };
}

export function toQuestionnaireDto(questionnaire: QuestionnaireDocument): QuestionnaireDto {
  return {
    id: questionnaire.id,
    studyId: questionnaire.studyId.toString(),
    version: questionnaire.version,
    source: questionnaire.source,
    title: questionnaire.title,
    audience: questionnaire.audience,
    topics: [...questionnaire.topics],
    questions: questionnaire.questions.map(({ key, text, goal }) => ({ key, text, goal })),
    createdAt: questionnaire.createdAt.toISOString(),
  };
}
