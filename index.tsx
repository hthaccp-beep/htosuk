import './utils/patchJsonCircular';
import React, { lazy, Suspense } from 'react';
import ReactDOM from 'react-dom/client';
import { configurationError } from './firebase-config';
import { AppRecovery } from './components/AppRecovery';

const App = lazy(() => import('./app/htos/HtosApp'));
const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Could not find app root.');
ReactDOM.createRoot(rootElement).render(configurationError ? (
  <main style={{ fontFamily: 'system-ui', maxWidth: 560, margin: '12vh auto', padding: 28 }}>
    <p style={{ color: '#166534', fontWeight: 700 }}>HTOS · Setup</p>
    <h1>Your new order system</h1>
    <p role="status">{configurationError}</p>
    <p>Your existing OrderSystem database has not been connected.</p>
  </main>
) : <AppRecovery><Suspense fallback={<p>Loading HTOS…</p>}><App /></Suspense></AppRecovery>);
