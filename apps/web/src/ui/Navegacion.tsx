import type { ReactNode } from 'react';
import { NavLink, Outlet } from 'react-router';

function Icono({ children }: { children: ReactNode }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      className="h-6 w-6"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}

const ENLACES = [
  {
    a: '/',
    texto: 'Inicio',
    icono: (
      <>
        <path d="M4 11.5 12 4l8 7.5" />
        <path d="M6 10v9h12v-9" />
      </>
    ),
  },
  {
    a: '/clientes',
    texto: 'Clientes',
    icono: (
      <>
        <circle cx="12" cy="8" r="3.5" />
        <path d="M5 20c.8-3.6 3.6-5.5 7-5.5s6.2 1.9 7 5.5" />
      </>
    ),
  },
  {
    a: '/prestamos',
    texto: 'Préstamos',
    icono: (
      <>
        <rect x="3" y="6" width="18" height="12" rx="2" />
        <circle cx="12" cy="12" r="2.5" />
        <path d="M6.5 9.5v.01M17.5 14.5v.01" />
      </>
    ),
  },
  {
    a: '/cuenta',
    texto: 'Cuenta',
    icono: (
      <>
        <path d="M5 7h14M5 12h14M5 17h14" />
        <circle cx="9" cy="7" r="1.8" fill="white" />
        <circle cx="15" cy="12" r="1.8" fill="white" />
        <circle cx="8" cy="17" r="1.8" fill="white" />
      </>
    ),
  },
];

/** Estructura con barra inferior de navegación (se usa desde el celular). */
export function ConNavegacion() {
  return (
    <>
      <Outlet />
      <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)]">
        <div className="mx-auto grid max-w-2xl grid-cols-4">
          {ENLACES.map((e) => (
            <NavLink
              key={e.a}
              to={e.a}
              end={e.a === '/'}
              className={({ isActive }) =>
                `flex flex-col items-center gap-0.5 py-2 text-xs ${isActive ? 'font-semibold text-emerald-700' : 'text-slate-500'}`
              }
            >
              <Icono>{e.icono}</Icono>
              {e.texto}
            </NavLink>
          ))}
        </div>
      </nav>
    </>
  );
}
