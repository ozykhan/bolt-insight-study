import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useParams } from 'react-router';
import type { QuestionnaireDto, QuestionnaireUpdate, StudyDetailDto } from '@probe-lab/shared';
import { api } from '../lib/api';

interface EditableQuestion {
  /** Local id for React keys; new questions have no server key yet. */
  uid: string;
  key?: string;
  text: string;
  goal: string;
}

interface EditorState {
  title: string;
  audience: string;
  topics: string;
  questions: EditableQuestion[];
}

let nextUid = 0;
const uid = () => `local-${nextUid++}`;

function toEditorState(questionnaire: QuestionnaireDto): EditorState {
  return {
    title: questionnaire.title,
    audience: questionnaire.audience,
    topics: questionnaire.topics.join(', '),
    questions: questionnaire.questions.map((q) => ({ uid: uid(), ...q })),
  };
}

function toUpdate(state: EditorState): QuestionnaireUpdate {
  return {
    title: state.title,
    audience: state.audience,
    topics: state.topics
      .split(',')
      .map((topic) => topic.trim())
      .filter(Boolean),
    questions: state.questions.map(({ key, text, goal }) => ({ key, text, goal })),
  };
}

export function StudyPage() {
  const { id } = useParams<{ id: string }>();
  const location = useLocation();
  const [detail, setDetail] = useState<StudyDetailDto | null>(null);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [busy, setBusy] = useState<'generating' | 'saving' | 'launching' | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(
    (location.state as { generationError?: string } | null)?.generationError ?? null,
  );

  const apply = useCallback((next: StudyDetailDto) => {
    setDetail(next);
    setEditor(next.questionnaire ? toEditorState(next.questionnaire) : null);
  }, []);

  useEffect(() => {
    if (id) api.getStudy(id).then(apply, (e: Error) => setError(e.message));
  }, [id, apply]);

  const dirty = useMemo(() => {
    if (!detail?.questionnaire || !editor) return false;
    return JSON.stringify(toUpdate(editor)) !== JSON.stringify(toUpdate(toEditorState(detail.questionnaire)));
  }, [detail, editor]);

  if (!detail) {
    return <p className={error ? 'error' : 'muted'}>{error ?? 'Loading...'}</p>;
  }

  const { study, questionnaire } = detail;
  const locked = study.status !== 'draft';

  async function run(kind: NonNullable<typeof busy>, action: () => Promise<void>) {
    setBusy(kind);
    setError(null);
    setNotice(null);
    try {
      await action();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const generate = () =>
    run('generating', async () => apply(await api.generateQuestionnaire(study.id)));

  const save = () =>
    run('saving', async () => {
      const result = await api.saveQuestionnaire(study.id, toUpdate(editor!));
      apply(result);
      setNotice(
        result.changed ? `Saved as version ${result.questionnaire?.version}.` : 'No changes to save.',
      );
    });

  const launch = () => run('launching', async () => apply(await api.launchStudy(study.id)));

  const updateQuestion = (index: number, patch: Partial<EditableQuestion>) =>
    setEditor((state) => state && {
      ...state,
      questions: state.questions.map((q, i) => (i === index ? { ...q, ...patch } : q)),
    });

  const moveQuestion = (index: number, offset: -1 | 1) =>
    setEditor((state) => {
      if (!state) return state;
      const questions = [...state.questions];
      const target = index + offset;
      if (target < 0 || target >= questions.length) return state;
      [questions[index], questions[target]] = [questions[target]!, questions[index]!];
      return { ...state, questions };
    });

  const removeQuestion = (index: number) =>
    setEditor((state) => state && {
      ...state,
      questions: state.questions.filter((_, i) => i !== index),
    });

  const addQuestion = () =>
    setEditor((state) => state && {
      ...state,
      questions: [...state.questions, { uid: uid(), text: '', goal: '' }],
    });

  const respondentLink = `${window.location.origin}/s/${study.id}`;

  return (
    <>
      <section className="card">
        <div className="row spread">
          <h1>{study.title}</h1>
          <span className={`badge badge-${study.status}`}>{study.status}</span>
        </div>
        <p className="brief">{study.brief}</p>
        {study.status === 'live' && (
          <div className="callout">
            <strong>The study is live.</strong> Share this link with respondents:{' '}
            <a href={respondentLink}>{respondentLink}</a>
            <button
              type="button"
              className="chip"
              onClick={() => navigator.clipboard.writeText(respondentLink)}
            >
              Copy
            </button>
          </div>
        )}
      </section>

      {!questionnaire && (
        <section className="card">
          <h2>Questionnaire</h2>
          <p className="muted">This study has no questionnaire yet.</p>
          <button type="button" className="primary" onClick={generate} disabled={busy !== null}>
            {busy === 'generating' ? 'Drafting...' : 'Draft questionnaire with Claude'}
          </button>
          {busy === 'generating' && (
            <p className="muted">This usually takes 20 to 60 seconds.</p>
          )}
          {error && <p className="error">{error}</p>}
        </section>
      )}

      {questionnaire && editor && (
        <section className="card">
          <div className="row spread">
            <h2>Questionnaire</h2>
            <span className="muted">
              Version {questionnaire.version} ({questionnaire.source})
            </span>
          </div>

          <fieldset disabled={locked || busy !== null} className="stack">
            <label>
              Title
              <input
                value={editor.title}
                onChange={(e) => setEditor({ ...editor, title: e.target.value })}
              />
            </label>
            <label>
              Audience
              <input
                value={editor.audience}
                onChange={(e) => setEditor({ ...editor, audience: e.target.value })}
              />
            </label>
            <label>
              Topics, separated by commas
              <input
                value={editor.topics}
                onChange={(e) => setEditor({ ...editor, topics: e.target.value })}
              />
            </label>

            <ol className="questions">
              {editor.questions.map((question, index) => (
                <li key={question.uid} className="question">
                  <div className="question-head">
                    <span className="question-number">Q{index + 1}</span>
                    {!locked && (
                      <span className="question-actions">
                        <button type="button" onClick={() => moveQuestion(index, -1)} disabled={index === 0} aria-label="Move up">
                          Up
                        </button>
                        <button
                          type="button"
                          onClick={() => moveQuestion(index, 1)}
                          disabled={index === editor.questions.length - 1}
                          aria-label="Move down"
                        >
                          Down
                        </button>
                        <button type="button" onClick={() => removeQuestion(index)} aria-label="Remove question">
                          Remove
                        </button>
                      </span>
                    )}
                  </div>
                  <textarea
                    value={question.text}
                    rows={2}
                    placeholder="The question, as the moderator will ask it"
                    onChange={(e) => updateQuestion(index, { text: e.target.value })}
                  />
                  <input
                    value={question.goal}
                    placeholder="Goal: what you want to learn from this question"
                    onChange={(e) => updateQuestion(index, { goal: e.target.value })}
                  />
                </li>
              ))}
            </ol>
            {!locked && (
              <button type="button" onClick={addQuestion}>
                Add question
              </button>
            )}
          </fieldset>

          {!locked && (
            <div className="row actions">
              <button type="button" onClick={save} disabled={!dirty || busy !== null}>
                {busy === 'saving' ? 'Saving...' : 'Save changes'}
              </button>
              <button
                type="button"
                className="primary"
                onClick={launch}
                disabled={dirty || busy !== null}
                title={dirty ? 'Save your changes before launching' : undefined}
              >
                {busy === 'launching' ? 'Launching...' : 'Launch study'}
              </button>
              {dirty && <span className="muted">Save your changes before launching.</span>}
              {notice && <span className="notice">{notice}</span>}
            </div>
          )}
          {error && <p className="error">{error}</p>}
        </section>
      )}
    </>
  );
}
