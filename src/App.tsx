import { lazy, Suspense, type ReactNode } from 'react';
import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './auth/AuthProvider';
import { AppShell } from './components/AppShell';
import { DeptLayout } from './components/DeptLayout';
import { Button, Empty, Spinner } from './components/ui';
import { TermProvider } from './lib/TermContext';
import Login from './pages/Login';

const Home = lazy(() => import('./pages/Home'));
const Courses = lazy(() => import('./pages/Courses'));
const CourseDetail = lazy(() => import('./pages/course/CourseDetail'));
const Calendar = lazy(() => import('./pages/Calendar'));
const Outcomes = lazy(() => import('./pages/Outcomes'));
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Assignments = lazy(() => import('./pages/admin/Assignments'));
const TermSetup = lazy(() => import('./pages/admin/TermSetup'));
const People = lazy(() => import('./pages/admin/People'));
const ImportPage = lazy(() => import('./pages/admin/Import'));
const Guide = lazy(() => import('./pages/Guide'));

function AdminOnly({ children }: { children: ReactNode }) {
  const { isAdmin } = useAuth();
  return isAdmin ? <>{children}</> : <Empty title="Admins only">This page is for the HOD and department admins.</Empty>;
}

/** The guide, readable before signing in (linked from the sign-in page). */
function PublicGuide() {
  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-30 h-14 flex items-center justify-between px-4 sm:px-6 border-b border-line bg-surface/90 backdrop-blur">
        <span className="text-sm font-semibold">BME Workflow</span>
        <Link to="/" className="link text-sm">Sign in</Link>
      </header>
      <main className="px-4 sm:px-6 lg:px-8 py-6 max-w-[1200px] mx-auto">
        <Suspense fallback={<Spinner />}><Guide signedOut /></Suspense>
      </main>
    </div>
  );
}

export default function App() {
  const { session, me, loading, error, retry, signOut, openAccess, isAdmin } = useAuth();
  const { pathname } = useLocation();
  if (loading) return <Spinner label="Signing in" />;
  if (error) return (
    <div className="min-h-dvh grid place-items-center p-6">
      <Empty title="Could not reach BME Workflow" action={<div className="flex gap-2"><Button variant="primary" onClick={retry}>Try again</Button><Button onClick={signOut}>Sign out</Button></div>}>
        {error}. Check your connection; if it continues, the database may be paused or misconfigured.
      </Empty>
    </div>
  );
  if (!openAccess && !session) return pathname === '/guide' ? <PublicGuide /> : <Login />;
  if (!me) return (
    <div className="min-h-dvh grid place-items-center p-6">
      <Empty title="Your account is not approved yet" action={<Button onClick={signOut}>Sign out</Button>}>
        {session?.user.email} is signed in but not on the department access list, or access was turned off. Ask the HOD or a department admin.
      </Empty>
    </div>
  );
  return (
    <TermProvider>
      <Suspense fallback={<Spinner />}>
        <Routes>
          <Route element={<AppShell />}>
            <Route index element={<Home />} />
            <Route element={<DeptLayout />}>
              <Route path="dashboard" element={<Dashboard />} />
              <Route path="courses" element={<Courses />} />
              <Route path="calendar" element={<Calendar />} />
              <Route path="outcomes" element={<Outcomes />} />
            </Route>
            <Route path="courses/:id/:tab?" element={<CourseDetail />} />
            <Route path="guide" element={<Guide isAdmin={isAdmin} />} />
            <Route path="admin/assignments" element={<AdminOnly><Assignments /></AdminOnly>} />
            <Route path="admin/term" element={<AdminOnly><TermSetup /></AdminOnly>} />
            <Route path="admin/people" element={<AdminOnly><People /></AdminOnly>} />
            <Route path="admin/import" element={<AdminOnly><ImportPage /></AdminOnly>} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </Suspense>
    </TermProvider>
  );
}
