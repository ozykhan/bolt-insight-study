import type {
  QuestionnaireUpdate,
  StudyDetailDto,
  StudyDto,
} from '@probe-lab/shared';

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
    headers: { 'content-type': 'application/json', ...init.headers },
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
};
