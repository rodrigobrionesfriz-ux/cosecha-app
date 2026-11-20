import { cargarTabla } from './datos';

export type Fila = {
  id: string; fecha: string; leido_en: string; estado: string; observacion: string | null;
  huerto: string; cuartel: string; variedad: string | null; envase: string; calidad: string | null;
  turno: string | null; contratista: string | null; cuadrilla: string | null; jefe: string | null;
  rut: string; trabajador: string; codigo_credencial: string; codigo_caja: string | null;
  cantidad: number; kilos_estimados: number; monto: number; monto_recargo: number; monto_total: number; tarifa: number; porcentaje_contratista: number;
  huerto_id: string; trabajador_id: string; cuartel_id: string; envase_id: string; calidad_id: string | null;
  contratista_id: string | null; turno_id: string | null;
  editada: boolean; anulada_en: string | null; motivo_anulacion: string | null; anulada_por_nombre: string | null;
};

/** vigentes = válidas + duplicadas por revisar (las anuladas nunca entran a reportes); anuladas = solo las anuladas */
export async function cargarEntregas(desde: string, hasta: string, huertoId?: string, modo: 'vigentes' | 'anuladas' = 'vigentes'): Promise<Fila[]> {
  return cargarTabla<Fila>('v_entregas_detalle', '*', (q) => {
    let r = q.gte('fecha', desde).lte('fecha', hasta);
    if (huertoId) r = r.eq('huerto_id', huertoId);
    r = modo === 'anuladas' ? r.eq('estado', 'X') : r.in('estado', ['A', 'D']);
    return r;
  }, 'leido_en');
}

export type Agregado = { clave: string; etiqueta: string; extra?: string; entregas: number; envases: number; kilos: number; monto: number; recargo: number; total: number; trabajadores: number };

export function agrupar(filas: Fila[], clave: (f: Fila) => string, etiqueta: (f: Fila) => string, extra?: (f: Fila) => string): Agregado[] {
  const m = new Map<string, Agregado & { _t: Set<string> }>();
  for (const f of filas) {
    if (f.estado !== 'A') continue;
    const k = clave(f);
    let a = m.get(k);
    if (!a) { a = { clave: k, etiqueta: etiqueta(f), extra: extra?.(f), entregas: 0, envases: 0, kilos: 0, monto: 0, recargo: 0, total: 0, trabajadores: 0, _t: new Set() }; m.set(k, a); }
    a.entregas++;
    a.envases += Number(f.cantidad);
    a.kilos += Number(f.kilos_estimados);
    a.monto += Number(f.monto);
    a.recargo += Number(f.monto_recargo || 0);
    a.total += Number(f.monto_total ?? f.monto);
    a._t.add(f.trabajador_id);
  }
  return [...m.values()].map(({ _t, ...a }) => ({ ...a, trabajadores: _t.size }));
}

export function totales(l: Agregado[]) {
  return l.reduce((t, a) => ({ entregas: t.entregas + a.entregas, envases: t.envases + a.envases, kilos: t.kilos + a.kilos, monto: t.monto + a.monto, recargo: t.recargo + a.recargo, total: t.total + a.total }), { entregas: 0, envases: 0, kilos: 0, monto: 0, recargo: 0, total: 0 });
}
