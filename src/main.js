import { jsx as _jsx } from "react/jsx-runtime";
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import App from './App';
import { AuthProvider } from './auth/AuthProvider';
import { ToastProvider } from './components/ui';
import './index.css';
import { installTapFeedback } from './lib/tap';
installTapFeedback();
const qc = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: true } } });
// HashRouter: deep links work on static hosting (GitHub Pages) without server rewrites.
createRoot(document.getElementById('root')).render(_jsx(StrictMode, { children: _jsx(QueryClientProvider, { client: qc, children: _jsx(AuthProvider, { children: _jsx(ToastProvider, { children: _jsx(HashRouter, { children: _jsx(App, {}) }) }) }) }) }));
