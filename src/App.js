import { Fragment as _Fragment, jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { lazy, Suspense } from 'react';
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
const DeptTree = lazy(() => import('./pages/DeptTree'));
const Outcomes = lazy(() => import('./pages/Outcomes'));
const Dashboard = lazy(() => import('./pages/Dashboard'));
const TermSetup = lazy(() => import('./pages/admin/TermSetup'));
const People = lazy(() => import('./pages/admin/People'));
const Guide = lazy(() => import('./pages/Guide'));
function AdminOnly({ children }) {
    const { isAdmin } = useAuth();
    return isAdmin ? _jsx(_Fragment, { children: children }) : _jsx(Empty, { title: "Admins only", children: "This page is for the HOD and department admins." });
}
/** The guide, readable before signing in (linked from the sign-in page). */
function PublicGuide() {
    return (_jsxs("div", { className: "min-h-dvh", children: [_jsxs("header", { className: "sticky top-0 z-30 h-14 flex items-center justify-between px-4 sm:px-6 border-b border-line bg-surface/90 backdrop-blur", children: [_jsx("span", { className: "text-sm font-semibold", children: "BME Workflow" }), _jsx(Link, { to: "/", className: "link text-sm", children: "Sign in" })] }), _jsx("main", { className: "px-4 sm:px-6 lg:px-8 py-6 max-w-[1200px] mx-auto", children: _jsx(Suspense, { fallback: _jsx(Spinner, {}), children: _jsx(Guide, { signedOut: true }) }) })] }));
}
export default function App() {
    const { session, me, loading, error, retry, signOut, openAccess, isAdmin } = useAuth();
    const { pathname } = useLocation();
    if (loading)
        return _jsx(Spinner, { label: "Signing in" });
    if (error)
        return (_jsx("div", { className: "min-h-dvh grid place-items-center p-6", children: _jsxs(Empty, { title: "Could not reach BME Workflow", action: _jsxs("div", { className: "flex gap-2", children: [_jsx(Button, { variant: "primary", onClick: retry, children: "Try again" }), _jsx(Button, { onClick: signOut, children: "Sign out" })] }), children: [error, ". Check your connection; if it continues, the database may be paused or misconfigured."] }) }));
    if (!openAccess && !session)
        return pathname === '/guide' ? _jsx(PublicGuide, {}) : _jsx(Login, {});
    if (!me)
        return (_jsx("div", { className: "min-h-dvh grid place-items-center p-6", children: _jsxs(Empty, { title: "Your account is not approved yet", action: _jsx(Button, { onClick: signOut, children: "Sign out" }), children: [session?.user.email, " is signed in but not on the department access list, or access was turned off. Ask the HOD or a department admin."] }) }));
    return (_jsx(TermProvider, { children: _jsx(Suspense, { fallback: _jsx(Spinner, {}), children: _jsx(Routes, { children: _jsxs(Route, { element: _jsx(AppShell, {}), children: [_jsx(Route, { index: true, element: _jsx(Home, {}) }), _jsxs(Route, { element: _jsx(DeptLayout, {}), children: [_jsx(Route, { path: "dashboard", element: _jsx(Dashboard, {}) }), _jsx(Route, { path: "courses", element: _jsx(Courses, {}) }), _jsx(Route, { path: "calendar", element: _jsx(Calendar, {}) }), _jsx(Route, { path: "tree", element: _jsx(DeptTree, {}) })] }), _jsx(Route, { path: "outcomes", element: _jsx(Outcomes, {}) }), _jsx(Route, { path: "courses/:id/:tab?", element: _jsx(CourseDetail, {}) }), _jsx(Route, { path: "guide", element: _jsx(Guide, { isAdmin: isAdmin }) }), _jsx(Route, { path: "admin/assignments", element: _jsx(Navigate, { to: "/admin/term/people", replace: true }) }), _jsx(Route, { path: "admin/term/:tab?", element: _jsx(AdminOnly, { children: _jsx(TermSetup, {}) }) }), _jsx(Route, { path: "admin/people", element: _jsx(AdminOnly, { children: _jsx(People, {}) }) }), _jsx(Route, { path: "admin/import", element: _jsx(Navigate, { to: "/admin/term/import", replace: true }) }), _jsx(Route, { path: "*", element: _jsx(Navigate, { to: "/", replace: true }) })] }) }) }) }));
}
