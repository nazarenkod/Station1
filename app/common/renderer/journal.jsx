import './i18next.js';
import '@fontsource-variable/inter';
import '@fontsource-variable/jetbrains-mono';
import {Suspense} from 'react';
import {createRoot} from 'react-dom/client';

import ErrorBoundary from './components/ErrorBoundary/ErrorBoundary.jsx';
import JournalWindow from './components/Journal/JournalWindow.jsx';
import Spinner from './components/Spinner/Spinner.jsx';
import {ThemeProvider} from './providers/ThemeProvider.jsx';

// the journal of the station lives in a window of its own, without the workstation around it
createRoot(document.getElementById('root')).render(
  <ErrorBoundary>
    <ThemeProvider>
      <Suspense fallback={<Spinner />}>
        <JournalWindow />
      </Suspense>
    </ThemeProvider>
  </ErrorBoundary>,
);
