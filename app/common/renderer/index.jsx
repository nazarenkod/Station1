import './i18next.js';
import '@fontsource-variable/inter';
import '@fontsource-variable/jetbrains-mono';
import {Suspense} from 'react';
import {createRoot} from 'react-dom/client';
import {Provider} from 'react-redux';
import {MemoryRouter, Route, Routes} from 'react-router';

import OpenA11y from './components/A11yTool/OpenA11y.jsx';
import AppDataTool from './components/AppData/AppDataTool.jsx';
import BuildsTool from './components/Builds/BuildsTool.jsx';
import Desk from './components/Desk/Desk.jsx';
import StationPage from './components/Desk/StationPage.jsx';
import ErrorBoundary from './components/ErrorBoundary/ErrorBoundary.jsx';
import LogsTool from './components/Logs/LogsTool.jsx';
import PerfTool from './components/Perf/PerfTool.jsx';
import ProjectsPage from './components/Projects/ProjectsPage.jsx';
import ProxyTool from './components/Proxy/ProxyTool.jsx';
import SessionBuilderPage from './components/SessionBuilder/SessionBuilder.jsx';
import SessionInspectorPage from './components/SessionInspector/SessionInspector.jsx';
import SettingsPage from './components/Settings/SettingsPage.jsx';
import Spinner from './components/Spinner/Spinner.jsx';
import Workstation from './components/Workstation/Workstation.jsx';
import {backend} from './polyfills.js';
import {ThemeProvider} from './providers/ThemeProvider.jsx';
import store from './store.js';

const container = document.getElementById('root');

// errors nobody caught go to the journal of the station, with their stack
window.addEventListener('error', (event) => backend.journal?.report({text: event.message, detail: event.error?.stack}));
window.addEventListener('unhandledrejection', (event) =>
  backend.journal?.report({
    text: `unhandled rejection: ${event.reason?.message ?? event.reason}`,
    detail: event.reason?.stack,
  }),
);

// without local tools (a plain web build) there is no desk to show: the Inspector opens first
const Home = backend.available ? Desk : SessionBuilderPage;

createRoot(container).render(
  <ErrorBoundary>
    <Provider store={store}>
      <ThemeProvider>
        <MemoryRouter initialEntries={['/']}>
          <Suspense fallback={<Spinner />}>
            <Routes>
              <Route element={<Workstation />}>
                <Route path="/" element={<Home />} />
                <Route path="/projects" element={<ProjectsPage />} />
                <Route path="/session" element={<SessionBuilderPage />} />
                <Route path="/inspector" element={<SessionInspectorPage />} />
                <Route path="/a11y" element={<OpenA11y />} />
                <Route path="/proxy" element={<ProxyTool />} />
                <Route path="/logs" element={<LogsTool />} />
                <Route path="/perf" element={<PerfTool />} />
                <Route path="/data" element={<AppDataTool />} />
                <Route path="/builds" element={<BuildsTool />} />
                <Route path="/station" element={<StationPage />} />
                <Route path="/settings" element={<SettingsPage />} />
              </Route>
            </Routes>
          </Suspense>
        </MemoryRouter>
      </ThemeProvider>
    </Provider>
  </ErrorBoundary>,
);
