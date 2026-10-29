import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Link, Route, Routes } from 'react-router';
import { StudiesPage } from './client/StudiesPage';
import { StudyPage } from './client/StudyPage';
import { InterviewPage } from './respondent/InterviewPage';
import './styles.css';

function ClientLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="shell">
      <header className="topbar">
        <Link to="/" className="brand">
          Probe Lab
        </Link>
        <span className="muted">AI-moderated interviews, a study project</span>
      </header>
      <main className="content">{children}</main>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<ClientLayout><StudiesPage /></ClientLayout>} />
        <Route path="/studies/:id" element={<ClientLayout><StudyPage /></ClientLayout>} />
        <Route path="/s/:studyId" element={<InterviewPage />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);
