import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import type { StudyDto } from '@probe-lab/shared';
import { api } from '../lib/api';

const EXAMPLE_BRIEFS = [
  'Why are parents switching infant formula brands? UK mothers 25 to 40.',
  'How do commuters choose between an e-bike and public transport? City workers aged 20 to 45.',
  'What stops people from trying plant-based yoghurt for the first time? UK adults 18 to 35.',
];

export function StudiesPage() {
  const navigate = useNavigate();
  const [studies, setStudies] = useState<StudyDto[] | null>(null);
  const [brief, setBrief] = useState('');
  const [phase, setPhase] = useState<'idle' | 'saving' | 'drafting'>('idle');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.listStudies().then(setStudies, (e: Error) => setError(e.message));
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setPhase('saving');
    try {
      const { study } = await api.createStudy(brief);
      setPhase('drafting');
      try {
        await api.generateQuestionnaire(study.id);
        navigate(`/studies/${study.id}`);
      } catch (e) {
        // The study is saved; its page offers to try the draft again.
        navigate(`/studies/${study.id}`, { state: { generationError: (e as Error).message } });
      }
    } catch (e) {
      setError((e as Error).message);
      setPhase('idle');
    }
  }

  const busy = phase !== 'idle';

  return (
    <>
      <section className="card">
        <h1>New study</h1>
        <p className="muted">
          Describe what you want to learn and who from. Claude turns the brief into a
          questionnaire you can edit before launching.
        </p>
        <form onSubmit={submit} className="stack">
          <textarea
            value={brief}
            onChange={(e) => setBrief(e.target.value)}
            rows={4}
            placeholder="What do you want to learn, and from whom?"
            disabled={busy}
          />
          <div className="examples">
            <span className="muted">Examples:</span>
            {EXAMPLE_BRIEFS.map((example) => (
              <button
                key={example}
                type="button"
                className="chip"
                onClick={() => setBrief(example)}
                disabled={busy}
              >
                {example}
              </button>
            ))}
          </div>
          <div className="row">
            <button type="submit" className="primary" disabled={busy || brief.trim().length < 15}>
              {phase === 'idle' ? 'Draft questionnaire' : 'Working...'}
            </button>
            {phase === 'drafting' && (
              <span className="muted">
                Claude is drafting the questionnaire. This usually takes 20 to 60 seconds.
              </span>
            )}
          </div>
          {error && <p className="error">{error}</p>}
        </form>
      </section>

      <section className="card">
        <h2>Studies</h2>
        {studies === null && !error && <p className="muted">Loading...</p>}
        {studies?.length === 0 && <p className="muted">No studies yet.</p>}
        {studies && studies.length > 0 && (
          <ul className="study-list">
            {studies.map((study) => (
              <li key={study.id}>
                <Link to={`/studies/${study.id}`}>{study.title}</Link>
                <span className={`badge badge-${study.status}`}>{study.status}</span>
                <span className="muted">{new Date(study.createdAt).toLocaleString()}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
