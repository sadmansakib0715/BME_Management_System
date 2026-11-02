import { lazy, Suspense, type ReactNode } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './auth/AuthProvider';
import { AppShell } from './components/AppShell';
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

function AdminOnly({ children }: { children: ReactNode }) {
  const { isAdmin } = useAuth();
  return isAdmin ? <>{children}</> : <Empty title="Admins only">This page is for the HOD and department admins.</Empty>;
}

export default function App() {
  const { session, me, loading, error, retry, signOut } = useAuth();
  if (loading) return <Spinner label="Signing in" />;
  if (!session) return <Login />;
  if (error) return (
    <div className="min-h-dvh grid place-items-center p-6">
      <Empty title="Could not reach BME Workflow" action={<div className="flex gap-2"><Button variant="primary" onClick={retry}>Try again</Button><Button onClick={signOut}>Sign out</Button></div>}>
        {error}. Check your connection; if it continues, the database may be paused or misconfigured.
      </Empty>
    </div>
  );
  if (!me) return (
    <div className="min-h-dvh grid place-items-center p-6">
      <Empty title="Your account is not approved yet" action={<Button onClick={signOut}>Sign out</Button>}>
        {session.user.email} is signed in but not on the department access list, or access was turned off. Ask the HOD or a department admin.
      </Empty>
    </div>
  );
  return (
    <TermProvider>
      <Suspense fallback={<Spinner />}>
        <Routes>
          <Route element={<AppShell />}>
            <Route index element={<Home />} />
            <Route path="courses" element={<Courses />} />
            <Route path="courses/:id/:tab?" element={<CourseDetail />} />
            <Route path="calendar" element={<Calendar />} />
            <Route path="outcomes" element={<Outcomes />} />
            <Route path="dashboard" element={<AdminOnly><Dashboard /></AdminOnly>} />
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
