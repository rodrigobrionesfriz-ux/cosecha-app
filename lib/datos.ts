'use client';
import { useCallback, useEffect, useState } from 'react';
import { supabase } from './supabase';

/** Carga una tabla completa (paginando) con filtros opcionales */
export async function cargarTabla<T = any>(tabla: string, select = '*', filtro?: (q: any) => any, orden?: string): Promise<T[]> {
  const out: T[] = [];
  const paso = 1000;
  for (let d = 0; ; d += paso) {
    let q: any = supabase.from(tabla).select(select).range(d, d + paso - 1);
    if (filtro) q = filtro(q);
    if (orden) q = q.order(orden);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    out.push(...((data || []) as T[]));
    if (!data || data.length < paso) break;
  }
  return out;
}

export function useTabla<T = any>(tabla: string, select = '*', orden?: string, filtro?: (q: any) => any) {
  const [filas, setFilas] = useState<T[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState('');
  const recargar = useCallback(async () => {
    setCargando(true);
    try { setFilas(await cargarTabla<T>(tabla, select, filtro, orden)); setError(''); }
    catch (e: any) { setError(e.message); }
    setCargando(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabla, select, orden]);
  useEffect(() => { recargar(); }, [recargar]);
  return { filas, cargando, error, recargar, setFilas };
}

export function errorAmigable(msg: string): string {
  if (/duplicate key|unique/i.test(msg)) return 'Ya existe un registro con ese nombre o código.';
  if (/foreign key/i.test(msg)) return 'No se puede eliminar: está siendo usado en otros registros. Desactívalo en su lugar.';
  if (/row-level security/i.test(msg)) return 'No tienes permiso para esta acción.';
  return msg;
}
