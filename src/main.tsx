/**
 * Browser entry point for the Barnes maze analyzer.
 *
 * Inputs:
 * - The application root DOM element and the App React component.
 *
 * Outputs:
 * - Mounted React application with global stylesheet initialization.
 *
 * Main operation:
 * - Creates the React root and renders App inside StrictMode.
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';

createRoot(document.getElementById('root')!).render(<StrictMode>
  <App />
</StrictMode>);
