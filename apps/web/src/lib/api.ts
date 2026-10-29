import {
  DISTINCT_ID_HEADER,
  type QuestionnaireUpdate,
  type StudyDetailDto,
  type StudyInsightsDto,
  type StudyDto,
} from '@probe-lab/shared';
import { distinctId } from './analytics';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...init,
    // The API sends its funnel events under the browser's PostHog id.
    headers: {
      'content-type': 'application/json',
      [DISTINCT_ID_HEADER]: distinctId(),
      ...init.headers,
    },
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const issues = body?.issues as Array<{ path: string; message: string }> | undefined;
    const detail = issues?.length
      ? issues.map((issue) => `${issue.path}: ${issue.message}`).join('; ')
      : null;
    throw new ApiError(detail ?? body?.message ?? response.statusText, response.status);
  }
  return body as T;
}

export const api = {
  listStudies: () => request<StudyDto[]>('/studies'),
  getStudy: (id: string) => request<StudyDetailDto>(`/studies/${id}`),
  createStudy: (brief: string) =>
    request<StudyDetailDto>('/studies', { method: 'POST', body: JSON.stringify({ brief }) }),
  generateQuestionnaire: (id: string) =>
    request<StudyDetailDto>(`/studies/${id}/questionnaire/generate`, { method: 'POST' }),
  saveQuestionnaire: (id: string, update: QuestionnaireUpdate) =>
    request<StudyDetailDto & { changed: boolean }>(`/studies/${id}/questionnaire`, {
      method: 'PUT',
      body: JSON.stringify(update),
    }),
  launchStudy: (id: string) =>
    request<StudyDetailDto>(`/studies/${id}/launch`, { method: 'POST' }),
  getInsights: (id: string) => request<StudyInsightsDto>(`/studies/${id}/insights`),
  generateInsights: (id: string) =>
    request<StudyInsightsDto>(`/studies/${id}/insights`, { method: 'POST' }),
};
