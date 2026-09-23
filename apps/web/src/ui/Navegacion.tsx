import { NavLink, Outlet } from 'react-router';

const ENLACES = [
  { a: '/', texto: 'Inicio', icono: '◉' },
  { a: '/clientes', texto: 'Clientes', icono: '☰' },
  { a: '/prestamos', texto: 'Préstamos', icono: '$' },
  { a: '/cuenta', texto: 'Cuenta', icono: '⚙' },
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
              <span className="text-lg leading-none" aria-hidden>
                {e.icono}
              </span>
              {e.texto}
            </NavLink>
          ))}
        </div>
      </nav>
    </>
  );
}
