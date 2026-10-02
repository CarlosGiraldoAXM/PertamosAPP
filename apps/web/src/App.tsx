import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { useSesion } from './auth/Sesion.tsx';
import { ClienteDetalle, Clientes } from './paginas/Clientes.tsx';
import { Cuenta } from './paginas/Cuenta.tsx';
import { Informe } from './paginas/Informe.tsx';
import { Inicio } from './paginas/Inicio.tsx';
import { Liquidar, RegistrarPago } from './paginas/Operaciones.tsx';
import { PrestamoDetalle } from './paginas/PrestamoDetalle.tsx';
import { PrestamoNuevo } from './paginas/PrestamoNuevo.tsx';
import { Prestamos } from './paginas/Prestamos.tsx';
import { ConNavegacion } from './ui/Navegacion.tsx';

export function App() {
  const { esAdmin } = useSesion();
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<ConNavegacion />}>
          <Route index element={<Inicio />} />
          <Route path="clientes" element={<Clientes />} />
          <Route path="clientes/:id" element={<ClienteDetalle />} />
          <Route path="prestamos" element={<Prestamos />} />
          <Route path="prestamos/:id" element={<PrestamoDetalle />} />
          <Route path="cuenta" element={<Cuenta />} />
        </Route>
        <Route path="informe" element={<Informe />} />
        {esAdmin && (
          <>
            <Route path="prestamos/nuevo" element={<PrestamoNuevo />} />
            <Route path="prestamos/:id/pago" element={<RegistrarPago />} />
            <Route path="prestamos/:id/liquidar" element={<Liquidar />} />
          </>
        )}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
