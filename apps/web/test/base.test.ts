// Lo que la base hace cumplir por sí misma, sin pasar por el Worker: se escribe
// directo en D1 como lo haría alguien que entre a la base por fuera de la app.
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import worker from '../worker/index.ts';
import { db, libro, pedir, prestamoNuevo, rechazo } from './ayudas.ts';

const uuid = () => crypto.randomUUID();

/** Prepara las sentencias de un asiento escrito a mano. */
function asiento(o: {
  prestamo: string;
  numero: number;
  monto: number;
  aplicado: number;
  reparto: [socio: string, interes: number][];
  tipo?: string;
  reversaDe?: string | null;
  fecha?: string;
}) {
  const pago = uuid();
  const aplicacion = uuid();
  return {
    pago,
    sentencias: [
      db
        .prepare('insert into pagos (id, prestamo_id, numero, tipo, fecha, monto, reversa_de) values (?, ?, ?, ?, ?, ?, ?)')
        .bind(pago, o.prestamo, o.numero, o.tipo ?? 'pago', o.fecha ?? '2026-02-15', o.monto, o.reversaDe ?? null),
      db.prepare('insert into aplicaciones (id, pago_id, periodo, a_interes) values (?, ?, 1, ?)').bind(aplicacion, pago, o.aplicado),
      ...o.reparto.map(([socio, interes]) =>
        db.prepare('insert into reparto_socios (aplicacion_id, socio_id, interes) values (?, ?, ?)').bind(aplicacion, socio, interes),
      ),
      db.prepare('insert into pagos_verificados (pago_id) values (?)').bind(pago),
    ],
  };
}

describe('las migraciones son aptas para producción', () => {
  it('todo trigger usa BEGIN y END en mayúsculas (D1 remoto corta el cuerpo si van en minúsculas)', () => {
    const triggers = env.TEST_MIGRATIONS.flatMap((m) => m.queries).filter((q) => /create\s+trigger/i.test(q));
    expect(triggers.length).toBeGreaterThanOrEqual(15);
    for (const sql of triggers) {
      const nombre = /create\s+trigger\s+(\w+)/i.exec(sql)![1];
      expect(sql, `${nombre}: falta BEGIN en mayúsculas`).toMatch(/\bBEGIN\b/);
      expect(sql.trimEnd().replace(/;$/, ''), `${nombre}: debe terminar en END en mayúsculas`).toMatch(/\bEND$/);
      expect(sql, `${nombre}: tiene begin/end en minúsculas`).not.toMatch(/\b(begin|end)\b/);
    }
  });
});

describe('el libro es inmutable', () => {
  it('no se puede modificar ni borrar un pago, una aplicación o un reparto', async () => {
    const { prestamo } = await prestamoNuevo();
    await pedir('POST', `/prestamos/${prestamo}/pagos`, { fecha: '2026-02-15', monto: 30_000 });
    const pago = (await libro(prestamo)).pagos[0]!;
    const aplicacion = pago.aplicaciones[0]!.id;

    expect(await rechazo(db.prepare('update pagos set monto = 1 where id = ?').bind(pago.id).run())).toContain('libro contable es inmutable');
    expect(await rechazo(db.prepare('delete from pagos where id = ?').bind(pago.id).run())).toContain('libro contable es inmutable');
    expect(await rechazo(db.prepare('update aplicaciones set a_interes = 1 where id = ?').bind(aplicacion).run())).toContain('inmutable');
    expect(await rechazo(db.prepare('delete from aplicaciones where id = ?').bind(aplicacion).run())).toContain('inmutable');
    expect(await rechazo(db.prepare('update reparto_socios set interes = 1 where aplicacion_id = ?').bind(aplicacion).run())).toContain('inmutable');
    expect(await rechazo(db.prepare('delete from reparto_socios where aplicacion_id = ?').bind(aplicacion).run())).toContain('inmutable');

    expect((await libro(prestamo)).pagos[0]!.monto).toBe(30_000);
  });
});

describe('las condiciones se congelan con el primer pago', () => {
  it('no se cambian la tasa, el capital ni los socios; el estado y las notas sí', async () => {
    const { prestamo, socioA } = await prestamoNuevo();
    await pedir('POST', `/prestamos/${prestamo}/pagos`, { fecha: '2026-02-15', monto: 30_000 });

    expect(await rechazo(db.prepare('update prestamos set tasa_mensual_bp = 400 where id = ?').bind(prestamo).run())).toContain(
      'condiciones de un préstamo con pagos',
    );
    expect(await rechazo(db.prepare('delete from prestamos where id = ?').bind(prestamo).run())).toContain('préstamo con pagos');
    expect(
      await rechazo(db.prepare('update prestamo_socios set tasa_bp = 150 where prestamo_id = ? and socio_id = ?').bind(prestamo, socioA).run()),
    ).toContain('socios de un préstamo con pagos');
    expect(await rechazo(db.prepare('delete from prestamo_socios where prestamo_id = ?').bind(prestamo).run())).toContain(
      'socios de un préstamo con pagos',
    );

    await db.prepare("update prestamos set estado = 'castigado', notas = 'x' where id = ?").bind(prestamo).run();
    expect((await libro(prestamo)).fila.estado).toBe('castigado');
  });
});

describe('sumas de control', () => {
  it('un préstamo cuyos socios no cuadran no queda guardado', async () => {
    const { cliente, socioA, socioB } = await prestamoNuevo();
    const id = uuid();
    const lote = (tasaB: number, aporteB: number) =>
      db.batch([
        db.prepare("insert into prestamos (id, cliente_id, capital_inicial, tasa_mensual_bp, fecha_desembolso) values (?, ?, 500000, 300, '2026-02-01')").bind(id, cliente),
        db.prepare('insert into prestamo_socios values (?, ?, 100, 200000)').bind(id, socioA),
        db.prepare('insert into prestamo_socios values (?, ?, ?, ?)').bind(id, socioB, tasaB, aporteB),
        db.prepare('insert into prestamos_verificados (prestamo_id) values (?)').bind(id),
      ]);

    expect(await rechazo(lote(100, 300_000))).toContain('tasas de los socios no suman');
    expect(await rechazo(lote(200, 200_000))).toContain('aportes de los socios no suman');
    // El batch es una transacción: no quedó nada a medias.
    expect(await db.prepare('select count(*) as n from prestamos where id = ?').bind(id).first('n')).toBe(0);

    await lote(200, 300_000);
    expect(await db.prepare('select count(*) as n from prestamo_socios where prestamo_id = ?').bind(id).first('n')).toBe(2);
  });

  it('un asiento que no cuadra no queda guardado', async () => {
    const { prestamo, socioA, socioB } = await prestamoNuevo();
    const base = { prestamo, numero: 1, monto: 30_000 };

    const noSuma = asiento({ ...base, aplicado: 29_000, reparto: [[socioA, 29_000]] });
    expect(await rechazo(db.batch(noSuma.sentencias))).toContain('aplicaciones no suman el monto');

    const repartoMalo = asiento({ ...base, aplicado: 30_000, reparto: [[socioA, 10_000]] });
    expect(await rechazo(db.batch(repartoMalo.sentencias))).toContain('reparto entre socios no cuadra');

    const otro = await prestamoNuevo();
    const socioAjeno = asiento({ ...base, aplicado: 30_000, reparto: [[otro.socioA, 30_000]] });
    expect(await rechazo(db.batch(socioAjeno.sentencias))).toContain('socio que no es del préstamo');

    expect((await libro(prestamo)).pagos).toHaveLength(0);

    const bueno = asiento({ ...base, aplicado: 30_000, reparto: [[socioA, 10_000], [socioB, 20_000]] });
    await db.batch(bueno.sentencias);
    expect((await libro(prestamo)).pagos).toHaveLength(1);
  });

  it('valida los reversos y la fecha del pago', async () => {
    const { prestamo, socioA, socioB } = await prestamoNuevo();
    await pedir('POST', `/prestamos/${prestamo}/pagos`, { fecha: '2026-02-15', monto: 30_000 });
    const original = (await libro(prestamo)).pagos[0]!.id;
    const reverso = (monto: number, numero = 2) =>
      asiento({ prestamo, numero, monto, aplicado: monto, tipo: 'reverso', reversaDe: original, fecha: '2026-02-16', reparto: [[socioA, monto / 3], [socioB, (monto * 2) / 3]] });

    expect(await rechazo(db.batch(reverso(-29_000 - 1).sentencias))).toContain('monto exacto');
    await db.batch(reverso(-30_000).sentencias);
    // Un pago se reversa una sola vez (unique en reversa_de).
    expect(await rechazo(db.batch(reverso(-30_000, 3).sentencias))).toMatch(/UNIQUE|reversa_de/);

    const viejo = asiento({ prestamo, numero: 3, monto: 1_000, aplicado: 1_000, fecha: '2026-01-01', reparto: [[socioA, 1_000]] });
    expect(await rechazo(db.batch(viejo.sentencias))).toContain('anterior al desembolso');
  });
});

describe('concurrencia: el consecutivo del préstamo', () => {
  it('un escritor con el libro desactualizado es rechazado', async () => {
    const { prestamo, socioA, socioB } = await prestamoNuevo();
    // Alguien leyó el libro cuando tenía 0 movimientos y preparó el número 1…
    const atrasado = asiento({ prestamo, numero: 1, monto: 30_000, aplicado: 30_000, reparto: [[socioA, 10_000], [socioB, 20_000]] });
    // …pero antes de que escriba, entra otro pago.
    await pedir('POST', `/prestamos/${prestamo}/pagos`, { fecha: '2026-02-15', monto: 30_000 });

    expect(await rechazo(db.batch(atrasado.sentencias))).toMatch(/CONFLICTO_SECUENCIA|UNIQUE/);
    expect((await libro(prestamo)).pagos).toHaveLength(1);
  });

  it('no se pueden dejar huecos ni saltarse el orden', async () => {
    const { prestamo, socioA, socioB } = await prestamoNuevo();
    const salto = asiento({ prestamo, numero: 5, monto: 30_000, aplicado: 30_000, reparto: [[socioA, 10_000], [socioB, 20_000]] });
    expect(await rechazo(db.batch(salto.sentencias))).toContain('CONFLICTO_SECUENCIA');
  });

  it('si otro pago entra entre la lectura y la escritura del Worker, este recalcula sobre el libro actualizado', async () => {
    const { prestamo } = await prestamoNuevo();
    // Cada pago cubre el mes (30.000) y abona 500.000. Si el Worker escribiera lo
    // que calculó sobre el libro viejo, el interés del mes 1 se cobraría dos veces.
    const pago = { fecha: '2026-02-10', monto: 530_000 };
    const ruta = `/prestamos/${prestamo}/pagos`;

    // Base "lenta": el primer batch del Worker es la lectura del libro y el segundo
    // la escritura. Justo antes de esa escritura se cuela otro pago completo.
    let lotes = 0;
    const dbConCarrera = new Proxy(db, {
      get(real, propiedad) {
        if (propiedad === 'batch') {
          return async (sentencias: D1PreparedStatement[]) => {
            if (++lotes === 2) expect((await pedir('POST', ruta, pago)).status).toBe(200);
            return real.batch(sentencias);
          };
        }
        const valor = Reflect.get(real, propiedad);
        return typeof valor === 'function' ? valor.bind(real) : valor;
      },
    });

    const r = await worker.fetch(
      new Request(`http://prestamos.test/api${ruta}`, { method: 'POST', body: JSON.stringify(pago) }),
      { ...env, DB: dbConCarrera },
    );

    // Leyó (1), chocó al escribir (2), volvió a leer (3) y core rechazó sobre el libro real.
    expect(lotes).toBe(3);
    expect(r.status).toBe(422);
    expect(((await r.json()) as { error: { codigo: string } }).error.codigo).toBe('PAGO_EXCEDE_DEUDA');
    const d = await libro(prestamo);
    expect(d.pagos).toHaveLength(1);
    expect(d.pagos[0]!.aplicaciones.filter((x) => x.periodo === 1)).toHaveLength(1);
  });
});
