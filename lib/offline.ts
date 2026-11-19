'use client';
// Base local del teléfono (IndexedDB) y sincronización con Supabase.
import Dexie, { type Table } from 'dexie';
import { supabase } from './supabase';
import { hoyISO } from './util';

export type EntregaLocal = {
  id: string;
  empresa_id: string;
  huerto_id: string;
  cuartel_id: string;
  variedad_id: string | null;
  envase_id: string;
  calidad_id: string | null;
  turno_id: string | null;
  contratista_id: string | null;
  cuadrilla_id: string | null;
  trabajador_id: string;
  codigo_credencial: string;
  codigo_caja: string | null;
  cantidad: number;
  kilos_estimados: number;
  leido_en: string;
  fecha: string;
  lat: number | null;
  lng: number | null;
  dispositivo: string;
  jefe_user_id: string;
  // solo local
  trabajador_nombre?: string;
  sync: 0 | 1;
  error?: string | null;
};

export type AsignacionLocal = {
  id: string;
  codigo: string;
  rut: string;
  nombres?: string;
  apellido_paterno?: string;
  apellido_materno?: string;
  contratista_id?: string | null;
  extranjero?: boolean;
  forzar?: boolean;
  creado_en: string;
  sync: 0 | 1;
  resultado?: string | null;
};

class CosechaDB extends Dexie {
  cache!: Table<{ key: string; data: any; actualizado: string }, string>;
  entregas!: Table<EntregaLocal, string>;
  asignaciones!: Table<AsignacionLocal, string>;
  constructor() {
    super('cosecha');
    this.version(1).stores({
      cache: 'key',
      entregas: 'id, fecha, sync, trabajador_id, codigo_caja',
      asignaciones: 'id, sync, codigo',
    });
  }
}

export const db = typeof window !== 'undefined' ? new CosechaDB() : (null as unknown as CosechaDB);

export async function getCache<T = any>(key: string): Promise<T | null> {
  const r = await db.cache.get(key);
  return r ? (r.data as T) : null;
}
export async function setCache(key: string, data: any) {
  await db.cache.put({ key, data, actualizado: new Date().toISOString() });
}

export function idDispositivo(): string {
  let id = localStorage.getItem('cosecha-dispositivo');
  if (!id) {
    id = 'DV-' + Math.random().toString(36).slice(2, 10).toUpperCase();
    localStorage.setItem('cosecha-dispositivo', id);
  }
  return id;
}

// ---------- Descarga de maestros ----------
const MAESTROS = ['huertos', 'cuarteles', 'variedades', 'especies', 'envases', 'calidades', 'turnos', 'contratistas', 'cuadrillas', 'config_huerto'];

export async function descargarMaestros(): Promise<void> {
  for (const t of MAESTROS) {
    let q = supabase.from(t).select('*');
    if (t !== 'config_huerto') q = q.eq('activo', true);
    if (t === 'cuarteles') q = q.eq('en_cosecha', true);
    const { data, error } = await q;
    if (error) throw new Error(`${t}: ${error.message}`);
    await setCache(t, data || []);
  }
  // Trabajadores (todos, para conocer bloqueados) y credenciales asignadas
  const trab = await traerTodo('trabajadores', 'id,rut,nombres,apellido_paterno,apellido_materno,estado,contratista_id');
  await setCache('trabajadores', trab);
  const tarj = await traerTodo('tarjetas', 'codigo,trabajador_id,estado', (q) => q.eq('tipo', 'W').eq('estado', 'asignada'));
  await setCache('credenciales', tarj);
  // Cajas ya leídas en las últimas 48 h (para detectar duplicados entre teléfonos)
  const desde = new Date(Date.now() - 48 * 3600 * 1000).toISOString();
  const cajas = await traerTodo('entregas', 'codigo_caja,leido_en', (q) => q.not('codigo_caja', 'is', null).eq('estado', 'A').gte('leido_en', desde));
  await setCache('cajas_servidor', cajas);
  await setCache('ultima_descarga', new Date().toISOString());
}

async function traerTodo(tabla: string, cols: string, filtro?: (q: any) => any) {
  const out: any[] = [];
  const paso = 1000;
  for (let desde = 0; ; desde += paso) {
    let q: any = supabase.from(tabla).select(cols).range(desde, desde + paso - 1);
    if (filtro) q = filtro(q);
    const { data, error } = await q;
    if (error) throw new Error(`${tabla}: ${error.message}`);
    out.push(...(data || []));
    if (!data || data.length < paso) break;
  }
  return out;
}

// ---------- Subida ----------
export async function subirPendientes(): Promise<{ entregas: number; asignaciones: number; errores: string[] }> {
  const errores: string[] = [];
  let nAsig = 0;
  // 1) asignaciones primero (las entregas pueden depender de un trabajador nuevo)
  const asig = await db.asignaciones.where('sync').equals(0).sortBy('creado_en');
  for (const a of asig) {
    const { data, error } = await supabase.rpc('asignar_credencial', {
      p_id: a.id, p_codigo: a.codigo, p_rut: a.rut, p_nombres: a.nombres || null,
      p_apellido_paterno: a.apellido_paterno || null, p_apellido_materno: a.apellido_materno || null,
      p_contratista_id: a.contratista_id || null, p_extranjero: !!a.extranjero, p_forzar: !!a.forzar,
    });
    if (error) { errores.push(`Credencial ${a.codigo}: ${error.message}`); continue; }
    await db.asignaciones.update(a.id, { sync: 1, resultado: (data as any)?.resultado });
    nAsig++;
  }
  // refrescar trabajadores para resolver ids de trabajadores creados offline
  if (nAsig) {
    try {
      await setCache('trabajadores', await traerTodo('trabajadores', 'id,rut,nombres,apellido_paterno,apellido_materno,estado,contratista_id'));
      await setCache('credenciales', await traerTodo('tarjetas', 'codigo,trabajador_id,estado', (q) => q.eq('tipo', 'W').eq('estado', 'asignada')));
    } catch {}
  }
  // 2) entregas en lotes de 100, idempotente por id
  let nEnt = 0;
  const pend = await db.entregas.where('sync').equals(0).toArray();
  const trabajadores: any[] = (await getCache('trabajadores')) || [];
  const credenciales: any[] = (await getCache('credenciales')) || [];
  for (let i = 0; i < pend.length; i += 100) {
    const lote = pend.slice(i, i + 100).map((e) => {
      const { sync, error, trabajador_nombre, ...rest } = e;
      // trabajador creado sin señal: resolver id real por la credencial
      if (rest.trabajador_id.startsWith('local:')) {
        const c = credenciales.find((x) => x.codigo === rest.codigo_credencial);
        if (c) rest.trabajador_id = c.trabajador_id;
      }
      return rest;
    }).filter((e) => !e.trabajador_id.startsWith('local:') && trabajadores.some((t) => t.id === e.trabajador_id));
    if (!lote.length) continue;
    const { error } = await supabase.from('entregas').upsert(lote, { onConflict: 'id', ignoreDuplicates: true });
    if (error) { errores.push(`Entregas: ${error.message}`); continue; }
    await db.entregas.bulkUpdate(lote.map((e) => ({ key: e.id, changes: { sync: 1 as const, trabajador_id: e.trabajador_id, error: null } })));
    nEnt += lote.length;
  }
  const sinResolver = await db.entregas.where('sync').equals(0).count();
  if (sinResolver && !errores.length) errores.push(`${sinResolver} entregas esperan que se registre la credencial del trabajador`);
  localStorage.setItem('cosecha-ultima-subida', new Date().toISOString());
  return { entregas: nEnt, asignaciones: nAsig, errores };
}

export async function sincronizar() {
  const r = await subirPendientes();
  await descargarMaestros();
  return r;
}

export async function limpiarAntiguas() {
  // Conserva 7 días de entregas ya sincronizadas en el teléfono
  const limite = hoyISO(new Date(Date.now() - 7 * 86400000));
  await db.entregas.where('fecha').below(limite).and((e) => e.sync === 1).delete();
}
