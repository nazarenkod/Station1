import './i18next.js';
import '@fontsource-variable/inter';
import '@fontsource-variable/jetbrains-mono';
import {AnimatePresence} from 'motion/react';
import {Suspense} from 'react';
import {createRoot} from 'react-dom/client';
import {Provider} from 'react-redux';
import {MemoryRouter, Route, Routes, useLocation} from 'react-router';

import {PageTransition} from './components/AppShell/motion.jsx';
import ErrorBoundary from './components/ErrorBoundary/ErrorBoundary.jsx';
import SessionBuilderPage from './components/SessionBuilder/SessionBuilder.jsx';
import SessionInspectorPage from './components/SessionInspector/SessionInspector.jsx';
import Spinner from './components/Spinner/Spinner.jsx';
import {ThemeProvider} from './providers/ThemeProvider.jsx';
import store from './store.js';

const container = document.getElementById('root');

// The builder and the inspector cross-fade instead of swapping abruptly
const AnimatedRoutes = () => {
  const location = useLocation();
  return (
    <AnimatePresence mode="wait">
      <PageTransition key={location.pathname}>
        <Routes location={location}>
          <Route path="/" element={<SessionBuilderPage />} />
          <Route path="/session" element={<SessionBuilderPage />} />
          <Route path="/inspector" element={<SessionInspectorPage />} />
        </Routes>
      </PageTransition>
    </AnimatePresence>
  );
};

createRoot(container).render(
  <ErrorBoundary>
    <Provider store={store}>
      <ThemeProvider>
        <MemoryRouter initialEntries={['/']}>
          <Suspense fallback={<Spinner />}>
            <AnimatedRoutes />
          </Suspense>
        </MemoryRouter>
      </ThemeProvider>
    </Provider>
  </ErrorBoundary>,
);
