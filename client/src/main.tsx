import { StrictMode, useSyncExternalStore, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { pb } from '@/api/pocketbase';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { installGlobalHandlers } from '@/lib/errorReporting';
import { Dashboard } from '@/pages/Dashboard';
import { Login } from '@/pages/Login';
import { Privacy } from '@/pages/Privacy';
import { ProjectWorkspace } from '@/pages/ProjectWorkspace';
import './index.css';

installGlobalHandlers();

function Protected({ children }: { children: ReactNode }) {
  const valid = useSyncExternalStore(
    (notify) => pb.authStore.onChange(notify),
    () => pb.authStore.isValid,
  );
  return valid ? children : <Navigate to="/login" replace />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/privacy" element={<Privacy />} />
          <Route path="/" element={<Protected><Dashboard /></Protected>} />
          <Route path="/projects/:id" element={<Protected><ProjectWorkspace /></Protected>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </ErrorBoundary>
  </StrictMode>,
);
