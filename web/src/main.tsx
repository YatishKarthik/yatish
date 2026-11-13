import '@fontsource-variable/geist';
import '@fontsource-variable/geist-mono';
import '@fontsource/michroma';
import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
