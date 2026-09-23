// Edge Functions de punta a punta contra Supabase local.
// Requiere `npm run db:start` (la base con el seed y las funciones servidas).
import postgres from 'postgres';
import { beforeAll, describe, expect, it } from 'vitest';
import { DB_URL, iniciarSesion, leer, llamar, prestamoBase, SEED } from './api.ts';

let admin: string;
let consulta: string;

beforeAll(async () => {
  admin = await iniciarSesion(SEED.admin.email, SEED.admin.clave);
  consulta = await iniciarSesion(SEED.consulta.email, SEED.consulta.clave);
});

async function crearPrestamo(extra: Record<string, unknown> = {}): Promise<string> {
  const r = await llamar('crear-prestamo', prestamoBase(extra), admin);
  expect(r.status, JSON.stringify(r.cuerpo)).toBe(200);
  return r.cuerpo.prestamoId;
}

describe('autenticación y permisos', () => {
  it('sin sesión → 401', async () => {
    const r = await llamar('registrar-pago', { prestamoId: SEED.cliente, monto: 1 });
    expect(r.status).toBe(401);
    expect(r.cuerpo.error.codigo).toBe('NO_AUTENTICADO');
  });

  it('con un token inventado → 401', async () => {
    const r = await llamar('crear-prestamo', prestamoBase(), 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.firma-falsa');
    expect(r.status).toBe(401);
  });

  it('un usuario de consulta no puede crear préstamos ni registrar pagos → 403', async () => {
    const prestamoId = await crearPrestamo();
    expect((await llamar('crear-prestamo', prestamoBase(), consulta)).status).toBe(403);
    const r = await llamar('registrar-pago', { prestamoId, fecha: '2026-02-15', monto: 30_000 }, consulta);
    expect(r.status).toBe(403);
    expect(r.cuerpo.error.codigo).toBe('SIN_PERMISO');
  });

  it('solo acepta POST', async () => {
    const r = await fetch('http://127.0.0.1:55621/functions/v1/registrar-pago', { method: 'GET' });
    expect(r.status).toBe(405);
  });
});

describe('crear-prestamo', () => {
  it('crea el préstamo con sus socios y devuelve plan y estado', async () => {
    const r = await llamar('crear-prestamo', prestamoBase({ plazoMeses: 3 }), admin);
    expect(r.status).toBe(200);
    expect(r.cuerpo.plan.cortes).toHaveLength(3);
    expect(r.cuerpo.plan.totalACobrar).toBe(1_090_000);
    expect(r.cuerpo.estado.saldoCapital).toBe(1_000_000);

    const socios = await leer(`prestamo_socios?prestamo_id=eq.${r.cuerpo.prestamoId}&select=socio_id,tasa_bp,aporte_capital&order=socio_id`, admin);
    expect(socios).toEqual([
      { socio_id: SEED.socioA, tasa_bp: 100, aporte_capital: 400_000 },
      { socio_id: SEED.socioB, tasa_bp: 200, aporte_capital: 600_000 },
    ]);
  });

  it('rechaza socios cuyas tasas no suman la del préstamo → 422', async () => {
    const r = await llamar('crear-prestamo', prestamoBase({ tasaMensualBp: 500 }), admin);
    expect(r.status).toBe(422);
    expect(r.cuerpo.error.codigo).toBe('SOCIOS_TASA_NO_CUADRA');
  });

  it('rechaza un desembolso en el futuro → 422', async () => {
    const r = await llamar('crear-prestamo', prestamoBase({ fechaDesembolso: '2099-01-01' }), admin);
    expect(r.status).toBe(422);
    expect(r.cuerpo.error.codigo).toBe('FECHA_FUTURA');
  });

  it('rechaza un cliente inexistente → 404', async () => {
    const r = await llamar('crear-prestamo', prestamoBase({ clienteId: '20000000-0000-4000-8000-00000000ffff' }), admin);
    expect(r.status).toBe(404);
  });

  it('rechaza entrada mal formada → 400', async () => {
    const r = await llamar('crear-prestamo', prestamoBase({ capital: 1000.5 }), admin);
    expect(r.status).toBe(400);
    expect(r.cuerpo.error.codigo).toBe('ENTRADA_INVALIDA');
  });
});

describe('ciclo de vida de un préstamo', () => {
  let prestamoId: string;

  beforeAll(async () => {
    prestamoId = await crearPrestamo();
  });

  it('simular no guarda nada', async () => {
    const r = await llamar('registrar-pago', { prestamoId, fecha: '2026-02-15', monto: 30_000, simular: true }, admin);
    expect(r.status).toBe(200);
    expect(r.cuerpo.simulado).toBe(true);
    expect(r.cuerpo.movimiento.aplicaciones[0]).toMatchObject({ periodo: 1, aInteres: 30_000 });
    expect(await leer(`pagos?prestamo_id=eq.${prestamoId}&select=id`, admin)).toHaveLength(0);
  });

  it('registra el pago del mes y guarda el asiento completo', async () => {
    const r = await llamar('registrar-pago', { prestamoId, fecha: '2026-02-15', monto: 30_000, medio: 'Nequi' }, admin);
    expect(r.status).toBe(200);
    const reparto = await leer(
      `reparto_socios?select=socio_id,interes,capital,aplicaciones!inner(pago_id)&aplicaciones.pago_id=eq.${r.cuerpo.pagoId}&order=socio_id`,
      admin,
    );
    expect(reparto.map((x: any) => [x.socio_id, x.interes, x.capital])).toEqual([
      [SEED.socioA, 10_000, 0],
      [SEED.socioB, 20_000, 0],
    ]);
  });

  it('un abono antes del corte paga el mes completo y baja capital', async () => {
    const r = await llamar('registrar-pago', { prestamoId, fecha: '2026-03-12', monto: 230_000 }, admin);
    expect(r.status).toBe(200);
    expect(r.cuerpo.estado.saldoCapital).toBe(800_000);
    expect(r.cuerpo.estado.socios.map((s: any) => s.capitalDevuelto)).toEqual([80_000, 120_000]);
  });

  it('rechaza un pago con fecha anterior al último → 422', async () => {
    const r = await llamar('registrar-pago', { prestamoId, fecha: '2026-03-01', monto: 24_000 }, admin);
    expect(r.status).toBe(422);
    expect(r.cuerpo.error.codigo).toBe('FECHA_ANTERIOR_A_ULTIMO_PAGO');
  });

  it('rechaza un pago que no cubre el interés vencido → 422', async () => {
    const r = await llamar('registrar-pago', { prestamoId, fecha: '2026-05-20', monto: 40_000 }, admin);
    expect(r.status).toBe(422);
    expect(r.cuerpo.error.codigo).toBe('PAGO_INSUFICIENTE');
  });

  it('cotiza, exige el monto cotizado y liquida; el préstamo queda pagado', async () => {
    const cot = await llamar('liquidar-prestamo', { prestamoId, fecha: '2026-06-05', simular: true }, admin);
    expect(cot.status).toBe(200);
    // Períodos 3 y 4 vencidos (24.000 c/u) + 20 días del período 5 (16.000) + 800.000 de capital.
    expect(cot.cuerpo.cotizacion).toMatchObject({ interesVencido: 48_000, interesEnCurso: 16_000, capital: 800_000, total: 864_000 });

    const mal = await llamar('liquidar-prestamo', { prestamoId, fecha: '2026-06-05', montoCotizado: 800_000 }, admin);
    expect(mal.status).toBe(422);
    expect(mal.cuerpo.error.codigo).toBe('COTIZACION_DESACTUALIZADA');

    const ok = await llamar('liquidar-prestamo', { prestamoId, fecha: '2026-06-05', montoCotizado: 864_000 }, admin);
    expect(ok.status).toBe(200);
    expect(ok.cuerpo.estado.cancelado).toBe(true);
    expect(ok.cuerpo.estadoPrestamo).toBe('pagado');
    expect(ok.cuerpo.estado.socios.map((s: any) => s.capitalPendiente)).toEqual([0, 0]);

    const [fila] = await leer(`prestamos?id=eq.${prestamoId}&select=estado`, admin);
    expect(fila.estado).toBe('pagado');

    const otro = await llamar('registrar-pago', { prestamoId, fecha: '2026-06-06', monto: 1_000 }, admin);
    expect(otro.status).toBe(422);
    expect(otro.cuerpo.error.codigo).toBe('PRESTAMO_CANCELADO');
  });

  it('reversar la liquidación reabre el préstamo; solo se reversa el último', async () => {
    const pagos = await leer<{ id: string; tipo: string }[]>(`pagos?prestamo_id=eq.${prestamoId}&select=id,tipo&order=secuencia`, admin);
    expect(pagos.map((p) => p.tipo)).toEqual(['pago', 'pago', 'liquidacion']);

    const noUltimo = await llamar('reversar-pago', { prestamoId, pagoId: pagos[0]!.id }, admin);
    expect(noUltimo.status).toBe(422);
    expect(noUltimo.cuerpo.error.codigo).toBe('REVERSO_NO_ES_ULTIMO');

    const r = await llamar('reversar-pago', { prestamoId, pagoId: pagos[2]!.id, nota: 'Liquidación registrada por error' }, admin);
    expect(r.status).toBe(200);
    expect(r.cuerpo.movimiento).toMatchObject({ tipo: 'reverso', monto: -864_000, reversaDe: pagos[2]!.id });
    expect(r.cuerpo.estadoPrestamo).toBe('activo');
    expect(r.cuerpo.estado.saldoCapital).toBe(800_000);

    const [fila] = await leer(`prestamos?id=eq.${prestamoId}&select=estado`, admin);
    expect(fila.estado).toBe('activo');
  });
});

describe('concurrencia', () => {
  it('la función lee el libro después de tomar el bloqueo (FOR UPDATE), no antes', async () => {
    const prestamoId = await crearPrestamo();
    const sql = postgres(DB_URL, { max: 1 });
    try {
      // Otra transacción bloquea el préstamo y registra un pago de 530.000 el 10-feb
      // (30.000 del mes 1 + 500.000 de capital), pero todavía no hace commit.
      let tomado!: () => void;
      let liberar!: () => void;
      const bloqueoTomado = new Promise<void>((r) => (tomado = r));
      const soltar = new Promise<void>((r) => (liberar = r));
      const retencion = sql.begin(async (tx) => {
        await tx`select id from public.prestamos where id = ${prestamoId} for update`;
        const [pago] = await tx`
          insert into public.pagos (prestamo_id, tipo, fecha, monto, creado_por)
          values (${prestamoId}, 'pago', '2026-02-10', 530000, '00000000-0000-4000-8000-000000000001') returning id`;
        const [interes] = await tx`
          insert into public.aplicaciones (pago_id, periodo, a_interes) values (${pago!.id}, 1, 30000) returning id`;
        const [capital] = await tx`
          insert into public.aplicaciones (pago_id, periodo, a_capital) values (${pago!.id}, null, 500000) returning id`;
        await tx`
          insert into public.reparto_socios (aplicacion_id, socio_id, interes, capital) values
            (${interes!.id}, ${SEED.socioA}, 10000, 0), (${interes!.id}, ${SEED.socioB}, 20000, 0),
            (${capital!.id}, ${SEED.socioA}, 0, 200000), (${capital!.id}, ${SEED.socioB}, 0, 300000)`;
        tomado();
        await soltar;
      });
      await bloqueoTomado;

      // Mientras tanto llega el mismo pago por la Edge Function.
      const llamada = llamar('registrar-pago', { prestamoId, fecha: '2026-02-10', monto: 530_000 }, admin);
      await new Promise((r) => setTimeout(r, 1_500));
      liberar();
      await retencion;
      const r = await llamada;

      // Si leyó después del bloqueo, ve el mes pagado y saldo 500.000 → rechaza.
      // Si hubiera leído antes, imputaría otra vez el interés del mes 1 y devolvería 200.
      expect(r.status, JSON.stringify(r.cuerpo)).toBe(422);
      expect(r.cuerpo.error.codigo).toBe('PAGO_EXCEDE_DEUDA');
      expect(await leer(`pagos?prestamo_id=eq.${prestamoId}&select=id`, admin)).toHaveLength(1);
    } finally {
      await sql.end();
    }
  });

  it('dos pagos simultáneos se serializan: el segundo ve el efecto del primero', async () => {
    const prestamoId = await crearPrestamo();
    // Cada uno cubre el mes (30.000) y abona 500.000. Sin bloqueo, ambos leerían saldo 1.000.000
    // y pasarían. Con FOR UPDATE, el segundo ve el mes ya pagado y 530.000 > saldo 500.000.
    const pago = { prestamoId, fecha: '2026-02-10', monto: 530_000 };
    const [a, b] = await Promise.all([llamar('registrar-pago', pago, admin), llamar('registrar-pago', pago, admin)]);

    expect([a.status, b.status].sort()).toEqual([200, 422]);
    const rechazado = a.status === 422 ? a : b;
    expect(rechazado.cuerpo.error.codigo).toBe('PAGO_EXCEDE_DEUDA');

    const pagos = await leer(`pagos?prestamo_id=eq.${prestamoId}&select=id`, admin);
    expect(pagos).toHaveLength(1);
  });
});
