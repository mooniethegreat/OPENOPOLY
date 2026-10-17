import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import RecoveryBoundary, { installViewDiagnostics } from './RecoveryBoundary.jsx';
import './styles.css';
import './recovery.css';
import './mobile-game.css';
import './table-chrome.css';
import './uno.css';

const stopDiagnostics = installViewDiagnostics();
if (import.meta.hot) import.meta.hot.dispose(stopDiagnostics);

createRoot(document.getElementById('root')).render(<React.StrictMode><RecoveryBoundary><App /></RecoveryBoundary></React.StrictMode>);
