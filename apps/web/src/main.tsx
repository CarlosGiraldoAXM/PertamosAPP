import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { ProveedorSesion } from './auth/Sesion.tsx';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ProveedorSesion>
      <App />
    </ProveedorSesion>
  </StrictMode>,
);
