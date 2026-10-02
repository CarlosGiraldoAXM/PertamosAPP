// La API de punta a punta, dentro del runtime de Workers con D1 local.
import { describe, expect, it } from 'vitest';
import { cuerpoPrestamo, escenario, libro, pedir, prestamoNuevo } from './ayudas.ts';

describe('clientes y socios', () => {
  it('crea, lista y edita clientes', async () => {
    const n = `doc-${Date.now()}`;
    const creado = await pedir('POST', '/clientes', { nombre: '  Ana Pérez  ', documento: n, telefono: '' });
    expect(creado.status).toBe(200);
    expect(creado.cuerpo).toMatchObject({ nombre: 'Ana Pérez', documento: n, telefono: null });

    const editado = await pedir('PATCH', `/clientes/${creado.cuerpo.id}`, { nombre: 'Ana Pérez', documento: n, telefono: '3001234567' });
    expect(editado.cuerpo.telefono).toBe('3001234567');

    const lista = await pedir('GET', '/clientes');
    expect(lista.cuerpo.some((c: { id: string }) => c.id === creado.cuerpo.id)).toBe(true);
  });

  it('rechaza un documento repetido → 409', async () => {
    const n = `dup-${Date.now()}`;
    await pedir('POST', '/clientes', { nombre: 'Uno', documento: n });
    const r = await pedir('POST', '/clientes', { nombre: 'Dos', documento: n });
    expect(r.status).toBe(409);
    expect(r.cuerpo.error.codigo).toBe('DOCUMENTO_DUPLICADO');
  });

  it('exige el nombre → 400', async () => {
    const r = await pedir('POST', '/clientes', { nombre: '   ' });
    expect(r.status).toBe(400);
    expect(r.cuerpo.error.codigo).toBe('ENTRADA_INVALIDA');
  });

  it('activa y desactiva socios', async () => {
    const { socioA } = await escenario();
    const r = await pedir('PATCH', `/socios/${socioA}`, { activo: false });
    expect(r.cuerpo.find((s: { id: string }) => s.id === socioA).activo).toBe(false);
  });

  it('rutas y recursos inexistentes → 404', async () => {
    expect((await pedir('GET', '/nada')).status).toBe(404);
    expect((await pedir('GET', '/clientes/20000000-0000-4000-8000-00000000ffff')).status).toBe(404);
    expect((await pedir('GET', '/prestamos/no-es-uuid')).status).toBe(404);
    expect((await pedir('GET', '/prestamos/30000000-0000-4000-8000-00000000ffff')).status).toBe(404);
  });
});

describe('crear préstamo', () => {
  it('crea el préstamo con sus socios y devuelve plan y estado', async () => {
    const e = await escenario();
    const r = await pedir('POST', '/prestamos', cuerpoPrestamo(e, { plazoMeses: 3 }));
    expect(r.status).toBe(200);
    expect(r.cuerpo.plan.cortes).toHaveLength(3);
    expect(r.cuerpo.plan.totalACobrar).toBe(1_090_000);
    expect(r.cuerpo.estado.saldoCapital).toBe(1_000_000);

    const d = await libro(r.cuerpo.prestamoId);
    expect(d.fila.socios).toHaveLength(2);
    expect(d.fila.socios.reduce((s, x) => s + x.aporte_capital, 0)).toBe(1_000_000);
  });

  it('rechaza socios cuyas tasas no suman la del préstamo → 422', async () => {
    const r = await pedir('POST', '/prestamos', cuerpoPrestamo(await escenario(), { tasaMensualBp: 500 }));
    expect(r.status).toBe(422);
    expect(r.cuerpo.error.codigo).toBe('SOCIOS_TASA_NO_CUADRA');
  });

  it('rechaza un desembolso en el futuro → 422', async () => {
    const r = await pedir('POST', '/prestamos', cuerpoPrestamo(await escenario(), { fechaDesembolso: '2099-01-01' }));
    expect(r.cuerpo.error.codigo).toBe('FECHA_FUTURA');
  });

  it('rechaza un cliente inexistente → 404 y un socio inactivo → 422', async () => {
    const e = await escenario();
    const sinCliente = await pedir('POST', '/prestamos', cuerpoPrestamo(e, { clienteId: '20000000-0000-4000-8000-00000000ffff' }));
    expect(sinCliente.status).toBe(404);

    await pedir('PATCH', `/socios/${e.socioB}`, { activo: false });
    const inactivo = await pedir('POST', '/prestamos', cuerpoPrestamo(e));
    expect(inactivo.status).toBe(422);
    expect(inactivo.cuerpo.error.codigo).toBe('SOCIO_INVALIDO');
  });

  it('rechaza entrada mal formada → 400', async () => {
    const r = await pedir('POST', '/prestamos', cuerpoPrestamo(await escenario(), { capital: 1000.5 }));
    expect(r.status).toBe(400);
  });
});

describe('ciclo de vida de un préstamo', () => {
  it('pago → abono → atraso → liquidación → reverso', async () => {
    const { prestamo, socioA, socioB } = await prestamoNuevo();
    const rutaPagos = `/prestamos/${prestamo}/pagos`;

    // Simular no guarda nada.
    const sim = await pedir('POST', rutaPagos, { fecha: '2026-02-15', monto: 30_000, simular: true });
    expect(sim.cuerpo.simulado).toBe(true);
    expect((await libro(prestamo)).pagos).toHaveLength(0);

    // Pago del mes: todo a interés, repartido 1 % / 2 %.
    const p1 = await pedir('POST', rutaPagos, { fecha: '2026-02-15', monto: 30_000, medio: 'Nequi' });
    expect(p1.status).toBe(200);
    const reparto = (await libro(prestamo)).pagos[0]!.aplicaciones[0]!.reparto;
    expect(Object.fromEntries(reparto.map((r) => [r.socio_id, r.interes]))).toEqual({ [socioA]: 10_000, [socioB]: 20_000 });

    // Abono antes del corte: paga el mes completo y baja capital por aportes.
    const p2 = await pedir('POST', rutaPagos, { fecha: '2026-03-12', monto: 230_000 });
    expect(p2.cuerpo.estado.saldoCapital).toBe(800_000);
    expect(p2.cuerpo.estado.socios.map((s: { capitalDevuelto: number }) => s.capitalDevuelto).sort()).toEqual([120_000, 80_000]);

    // Reglas de core que llegan como 422.
    const anterior = await pedir('POST', rutaPagos, { fecha: '2026-03-01', monto: 24_000 });
    expect(anterior.cuerpo.error.codigo).toBe('FECHA_ANTERIOR_A_ULTIMO_PAGO');
    const insuficiente = await pedir('POST', rutaPagos, { fecha: '2026-05-20', monto: 40_000 });
    expect(insuficiente.status).toBe(422);
    expect(insuficiente.cuerpo.error.codigo).toBe('PAGO_INSUFICIENTE');

    // Liquidación: 2 meses vencidos (24.000 c/u) + 20 días del mes en curso (16.000) + 800.000.
    const ruta = `/prestamos/${prestamo}/liquidacion`;
    const cot = await pedir('POST', ruta, { fecha: '2026-06-05', simular: true });
    expect(cot.cuerpo.cotizacion).toMatchObject({ interesVencido: 48_000, interesEnCurso: 16_000, capital: 800_000, total: 864_000 });
    const mal = await pedir('POST', ruta, { fecha: '2026-06-05', montoCotizado: 800_000 });
    expect(mal.cuerpo.error.codigo).toBe('COTIZACION_DESACTUALIZADA');
    const ok = await pedir('POST', ruta, { fecha: '2026-06-05', montoCotizado: 864_000 });
    expect(ok.status).toBe(200);
    expect(ok.cuerpo.estado.cancelado).toBe(true);
    expect(ok.cuerpo.estadoPrestamo).toBe('pagado');
    expect((await libro(prestamo)).fila.estado).toBe('pagado');

    const otro = await pedir('POST', rutaPagos, { fecha: '2026-06-06', monto: 1_000 });
    expect(otro.cuerpo.error.codigo).toBe('PRESTAMO_CANCELADO');

    // Reverso: solo el último, y reabre el préstamo.
    const pagos = (await libro(prestamo)).pagos;
    expect(pagos.map((p) => [p.numero, p.tipo])).toEqual([
      [1, 'pago'],
      [2, 'pago'],
      [3, 'liquidacion'],
    ]);
    const rutaReversos = `/prestamos/${prestamo}/reversos`;
    const noUltimo = await pedir('POST', rutaReversos, { pagoId: pagos[0]!.id });
    expect(noUltimo.cuerpo.error.codigo).toBe('REVERSO_NO_ES_ULTIMO');
    const rev = await pedir('POST', rutaReversos, { pagoId: pagos[2]!.id, nota: 'Registrada por error' });
    expect(rev.status).toBe(200);
    expect(rev.cuerpo.movimiento).toMatchObject({ tipo: 'reverso', monto: -864_000 });
    expect(rev.cuerpo.estadoPrestamo).toBe('activo');
    expect(rev.cuerpo.estado.saldoCapital).toBe(800_000);
    expect((await libro(prestamo)).fila.estado).toBe('activo');
  });

  it('adelantar el próximo mes: paga un solo mes por adelantado y el resto baja el capital', async () => {
    const { prestamo } = await prestamoNuevo();
    const ruta = `/prestamos/${prestamo}/pagos`;
    // 10-feb: corre el mes 1. 90.000 = mes 1 + mes 2 adelantado + 30.000 a capital.
    const r = await pedir('POST', ruta, { fecha: '2026-02-10', monto: 90_000, sobrante: 'adelantar' });
    expect(r.status).toBe(200);
    expect(
      r.cuerpo.movimiento.aplicaciones.map((a: { periodo: number | null; aInteres: number; aCapital: number }) => [a.periodo, a.aInteres, a.aCapital]),
    ).toEqual([
      [1, 30_000, 0],
      [2, 30_000, 0],
      [null, 0, 30_000],
    ]);
    expect(r.cuerpo.estado.saldoCapital).toBe(970_000);
    const d = await libro(prestamo);
    expect(d.pagos[0]!.aplicaciones.map((a) => a.periodo)).toEqual([1, 2, null]);

    // Sin la opción, el mismo sobrante va a capital (comportamiento por defecto).
    const otro = await prestamoNuevo();
    const porDefecto = await pedir('POST', `/prestamos/${otro.prestamo}/pagos`, { fecha: '2026-02-10', monto: 90_000 });
    expect(porDefecto.cuerpo.estado.saldoCapital).toBe(940_000);

    const invalido = await pedir('POST', ruta, { fecha: '2026-02-20', monto: 30_000, sobrante: 'regalar' });
    expect(invalido.status).toBe(400);
  });

  it('GET /prestamos trae la cartera y filtra por cliente', async () => {
    const { prestamo, cliente } = await prestamoNuevo();
    const delCliente = await pedir('GET', `/prestamos?clienteId=${cliente}`);
    expect(delCliente.cuerpo.map((d: { fila: { id: string } }) => d.fila.id)).toEqual([prestamo]);
    const todos = await pedir('GET', '/prestamos');
    expect(todos.cuerpo.length).toBeGreaterThanOrEqual(1);
  });
});
