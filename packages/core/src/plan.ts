import { assertBp, assertPesos, assertPesosNoNegativos, interesMensual, techoMil, type Pesos, type PuntosBasicos } from './dinero.ts';
import { ErrorNegocio } from './errores.ts';
import { assertFecha, fechaCorte, type FechaISO } from './fechas.ts';

export interface CondicionesPrestamo {
  capital: Pesos;
  tasaMensualBp: PuntosBasicos;
  fechaDesembolso: FechaISO;
  /** Mes en que se debe devolver todo el capital. `null` = "cuando pueda". */
  plazoMeses: number | null;
}

export interface CorteProyectado {
  numero: number;
  /** Corte anterior (o desembolso): el período es `(fechaInicio, fechaCorte]`. */
  fechaInicio: FechaISO;
  fechaCorte: FechaISO;
  saldoInicial: Pesos;
  /** Interés del mes sin redondear (al peso). */
  interesExacto: Pesos;
  /** Lo que se le cobra al cliente: interés redondeado a los mil, o todo el saldo en el último corte. */
  cuotaACobrar: Pesos;
  /** Parte de la cuota que baja el capital (excedente del redondeo o devolución final). */
  abonoCapital: Pesos;
  saldoFinal: Pesos;
}

export interface PlanDePagos {
  cortes: CorteProyectado[];
  totalInteres: Pesos;
  totalCapital: Pesos;
  totalACobrar: Pesos;
  /** Capital que sigue pendiente al final de la proyección (0 si hay plazo). */
  saldoAlFinal: Pesos;
}

export interface OpcionesPlan {
  /** Meses a proyectar cuando el préstamo no tiene plazo. Por defecto 12. */
  horizonteMeses?: number;
}

const HORIZONTE_POR_DEFECTO = 12;
const MAX_MESES = 600;

function assertMeses(valor: number, nombre: string): void {
  if (!Number.isSafeInteger(valor) || valor < 1 || valor > MAX_MESES) {
    throw new ErrorNegocio('PLAZO_INVALIDO', `${nombre} debe ser un entero entre 1 y ${MAX_MESES}, llegó ${valor}`);
  }
}

export function validarCondiciones(c: CondicionesPrestamo): void {
  assertPesos(c.capital, 'capital');
  if (c.capital <= 0) throw new ErrorNegocio('MONTO_INVALIDO', 'El capital debe ser mayor que 0');
  assertBp(c.tasaMensualBp, 'tasa mensual');
  if (c.tasaMensualBp === 0) throw new ErrorNegocio('TASA_INVALIDA', 'La tasa mensual debe ser mayor que 0');
  assertFecha(c.fechaDesembolso);
  if (c.plazoMeses !== null) assertMeses(c.plazoMeses, 'plazo');
}

export interface OpcionesProyeccion {
  /**
   * Interés pendiente del primer corte, cuando ya se conoce (el período en
   * curso se calcula sobre el saldo de su corte anterior y puede estar
   * parcialmente pagado). Por defecto, `saldo · tasa`.
   */
  interesPrimerCorte?: Pesos;
}

/**
 * Proyecta cortes desde `desdeNumero` partiendo de `saldo`, suponiendo que el
 * cliente paga cada mes la cuota redondeada (el excedente baja el capital) y,
 * si hay plazo, todo el capital en el corte del plazo o en el primero después.
 * Se detiene al llegar a saldo 0.
 */
export function proyectarCortes(
  c: CondicionesPrestamo,
  saldo: Pesos,
  desdeNumero: number,
  cantidad: number,
  opciones: OpcionesProyeccion = {},
): CorteProyectado[] {
  validarCondiciones(c);
  assertPesos(saldo, 'saldo');
  if (saldo < 0) throw new ErrorNegocio('MONTO_INVALIDO', 'El saldo no puede ser negativo');
  if (!Number.isSafeInteger(desdeNumero) || desdeNumero < 1) {
    throw new ErrorNegocio('PERIODO_INVALIDO', `Número de corte inválido: ${desdeNumero}`);
  }
  assertMeses(cantidad, 'cantidad de meses');
  if (opciones.interesPrimerCorte !== undefined) assertPesosNoNegativos(opciones.interesPrimerCorte, 'interés del primer corte');

  const cortes: CorteProyectado[] = [];
  for (let k = desdeNumero; k < desdeNumero + cantidad && saldo > 0; k++) {
    const interesExacto =
      k === desdeNumero && opciones.interesPrimerCorte !== undefined
        ? opciones.interesPrimerCorte
        : interesMensual(saldo, c.tasaMensualBp);
    const venceCapital = c.plazoMeses !== null && k >= c.plazoMeses;
    const cuotaACobrar = venceCapital
      ? interesExacto + saldo
      : Math.min(techoMil(interesExacto), interesExacto + saldo);
    const abonoCapital = cuotaACobrar - interesExacto;
    cortes.push({
      numero: k,
      fechaInicio: fechaCorte(c.fechaDesembolso, k - 1),
      fechaCorte: fechaCorte(c.fechaDesembolso, k),
      saldoInicial: saldo,
      interesExacto,
      cuotaACobrar,
      abonoCapital,
      saldoFinal: saldo - abonoCapital,
    });
    saldo -= abonoCapital;
  }
  return cortes;
}

/**
 * Plan de pagos de un préstamo recién desembolsado. Con plazo proyecta hasta
 * el plazo (el último corte devuelve todo el capital); sin plazo proyecta
 * `horizonteMeses` meses y deja el saldo pendiente en `saldoAlFinal`.
 */
export function generarPlanDePagos(c: CondicionesPrestamo, opciones: OpcionesPlan = {}): PlanDePagos {
  validarCondiciones(c);
  const horizonte = opciones.horizonteMeses ?? HORIZONTE_POR_DEFECTO;
  assertMeses(horizonte, 'horizonte');

  const cortes = proyectarCortes(c, c.capital, 1, c.plazoMeses ?? horizonte);
  const totalInteres = cortes.reduce((s, x) => s + x.interesExacto, 0);
  const totalCapital = cortes.reduce((s, x) => s + x.abonoCapital, 0);
  return {
    cortes,
    totalInteres,
    totalCapital,
    totalACobrar: totalInteres + totalCapital,
    saldoAlFinal: c.capital - totalCapital,
  };
}
