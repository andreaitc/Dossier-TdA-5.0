
import React from 'react';
import ReactDOM from 'react-dom/client';
// Fix: Use named import for App as App.tsx does not provide a default export
import { App } from './App';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
