import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { ErrorBoundary } from './components/ErrorBoundary';
import { AuthProvider } from './contexts/AuthContext';
import { initAppUpdateWatcher } from './lib/appUpdate';
import { pruneExpiredOfflineItems } from './lib/offlineCache';
import './index.css';

// Initialize PWA Service Worker registration & version update prompt watcher
initAppUpdateWatcher();

// Clean up any expired temporary offline cache entries on startup
void pruneExpiredOfflineItems();

createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <AuthProvider>
      <App />
    </AuthProvider>
  </ErrorBoundary>
);
