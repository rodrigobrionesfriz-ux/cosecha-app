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
  bin_id?: string | null;
  operador_id?: string | null;
  // solo local
  trabajador_nombre?: string;
  estado?: 'A' | 'D' | 'X' | 'B';
  editada?: boolean;
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
  actualiza_contratista?: boolean; // trabajador existente al que se le cambió el contratista
  extranjero?: boolean;
  forzar?: boolean;
  creado_en: string;
  usuario?: string; // quién la hizo en este teléfono
  sync: 0 | 1;
  resultado?: string | null;
};

/** Movimiento de un bin (abrir, cerrar, recibir, cámara, despacho…) hecho en el teléfono */
export type EventoLocal = {
  id: string;
  codigo: string;
  tipo: 'abrir' | 'cerrar' | 'armar' | 'recibir' | 'camara_entrada' | 'camara_salida' | 'despachar';
  bin_id: string | null;
  datos: any;
  hecho_en: string;
  dispositivo: string;
  usuario: string;
  fotos_locales?: { nombre: string; blob: Blob }[]; // se suben a Storage antes que el evento
  sync: 0 | 1;
  resultado?: string | null;
  mensaje?: string | null;
};

/** Despacho (camión) creado en el teléfono de acopio */
export type DespachoLocal = {
  id: string; empresa_id: string; patente: string; guia: string; destino: string; chofer: string;
  estado: 'abierto' | 'cerrado'; abierto_en: string; cerrado_en: string | null; usuario: string; sync: 0 | 1;
};

class CosechaDB extends Dexie {
  cache!: Table<{ key: string; data: any; actualizado: string }, string>;
  entregas!: Table<EntregaLocal, string>;
  asignaciones!: Table<AsignacionLocal, string>;
  eventos!: Table<EventoLocal, string>;
  despachos!: Table<DespachoLocal, string>;
  constructor() {
    super('cosecha');
    this.version(1).stores({
      cache: 'key',
      entregas: 'id, fecha, sync, trabajador_id, codigo_caja',
      asignaciones: 'id, sync, codigo',
    });
    this.version(2).stores({
      entregas: 'id, fecha, sync, trabajador_id, codigo_caja, bin_id',
      eventos: 'id, sync, codigo, hecho_en, tipo',
      despachos: 'id, sync, estado',
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

/** Usuario con sesión en este teléfono (se guarda al entrar a la app de terreno) */
export function usuarioActual(): string {
  return localStorage.getItem('cosecha-usuario') || '';
}

/**
 * Al cambiar de usuario en el mismo teléfono: borra lo ya subido del usuario anterior
 * (queda en el servidor) y deja aparte lo que no alcanzó a subir.
 */
export async function prepararUsuario(uid: string) {
  const previo = localStorage.getItem('cosecha-usuario');
  if (previo === uid) return;
  await db.entregas.filter((e) => e.sync === 1 && e.jefe_user_id !== uid).delete();
  await db.asignaciones.filter((a) => a.sync === 1).delete();
  await db.eventos.filter((e) => e.sync === 1 && e.usuario !== uid).delete();
  localStorage.setItem('cosecha-usuario', uid);
}

/** Entregas de este usuario (en el teléfono puede haber pendientes de otro usuario) */
export const propia = (e: EntregaLocal) => e.jefe_user_id === usuarioActual();

/** Pendientes de subir: los míos y los que dejó otro usuario en este teléfono */
export async function contarPendientes() {
  const uid = usuarioActual();
  const ent = await db.entregas.where('sync').equals(0).toArray();
  const asig = await db.asignaciones.where('sync').equals(0).toArray();
  const ev = await db.eventos.where('sync').equals(0).toArray();
  const mias = ent.filter((e) => e.jefe_user_id === uid).length + asig.filter((a) => !a.usuario || a.usuario === uid).length + ev.filter((e) => e.usuario === uid).length;
  const otros = ent.filter((e) => e.jefe_user_id !== uid).length + asig.filter((a) => a.usuario && a.usuario !== uid).length + ev.filter((e) => e.usuario !== uid).length;
  return { mias, otros };
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
const MAESTROS = ['huertos', 'cuarteles', 'variedades', 'especies', 'envases', 'calidades', 'turnos', 'contratistas', 'cuadrillas', 'config_huerto', 'camaras', 'parametros_calidad', 'operadores'];

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
  // Bins en curso (para validar sin señal y saber qué hay en acopio y cámara)
  const bins = await traerTodo('v_bins', 'id,codigo,estado,origen,huerto_id,cuartel_id,abierto_por,abierto_por_nombre,huerto,cuartel,variedad,cuadrilla,envases,kilos,abierto_en,cerrado_en,recibido_en,camara_id,camara,camara_inicio,minutos_alerta,minutos_objetivo,despacho_id',
    (q) => q.not('estado', 'in', '(despachado,anulado)'));
  await setCache('bins_activos', bins);
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
export async function subirPendientes(): Promise<{ entregas: number; asignaciones: number; eventos: number; errores: string[] }> {
  const errores: string[] = [];
  let nAsig = 0;
  // 1) asignaciones primero (las entregas pueden depender de un trabajador nuevo)
  const uid = usuarioActual();
  const asig = (await db.asignaciones.where('sync').equals(0).sortBy('creado_en')).filter((a) => !a.usuario || a.usuario === uid);
  for (const a of asig) {
    const { data, error } = await supabase.rpc('asignar_credencial', {
      p_id: a.id, p_codigo: a.codigo, p_rut: a.rut, p_nombres: a.nombres || null,
      p_apellido_paterno: a.apellido_paterno || null, p_apellido_materno: a.apellido_materno || null,
      p_contratista_id: a.contratista_id || null, p_extranjero: !!a.extranjero, p_forzar: !!a.forzar,
      ...(a.actualiza_contratista ? { p_actualiza_contratista: true } : {}),
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
  // 2) despachos y movimientos de bins
  const nEv = await subirEventos(uid, errores);
  // 3) entregas en lotes de 100, idempotente por id
  let nEnt = 0;
  const pend = (await db.entregas.where('sync').equals(0).toArray()).filter((e) => e.jefe_user_id === uid);
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
  const sinResolver = (await db.entregas.where('sync').equals(0).toArray()).filter((e) => e.jefe_user_id === uid).length;
  if (sinResolver && !errores.length) errores.push(`${sinResolver} entregas esperan que se registre la credencial del trabajador`);
  localStorage.setItem('cosecha-ultima-subida', new Date().toISOString());
  return { entregas: nEnt, asignaciones: nAsig, eventos: nEv, errores };
}

/** Sube despachos, fotos y eventos de bins; trae el resultado que dio el servidor a cada evento */
async function subirEventos(uid: string, errores: string[]): Promise<number> {
  const desp = (await db.despachos.where('sync').equals(0).toArray()).filter((d) => d.usuario === uid);
  for (const d of desp) {
    const { sync, usuario, ...rest } = d;
    const { error } = await supabase.from('despachos').upsert(rest, { onConflict: 'id' });
    if (error) { errores.push(`Despacho: ${error.message}`); continue; }
    await db.despachos.update(d.id, { sync: 1 });
  }
  const pend = (await db.eventos.where('sync').equals(0).sortBy('hecho_en')).filter((e) => e.usuario === uid);
  if (!pend.length) return 0;
  const listos: EventoLocal[] = [];
  for (const e of pend) {
    // fotos primero (si alguna falla, el evento espera a la próxima sincronización)
    if (e.fotos_locales?.length) {
      let ok = true;
      for (const f of e.fotos_locales) {
        const { error } = await supabase.storage.from('acopio-fotos').upload(f.nombre, f.blob, { upsert: true, contentType: 'image/jpeg' });
        if (error && !/exists/i.test(error.message)) { ok = false; errores.push(`Foto: ${error.message}`); break; }
      }
      if (!ok) continue;
    }
    listos.push(e);
  }
  // en orden: un bin se abre antes de cerrarse, recibirse, etc.
  let n = 0;
  for (let i = 0; i < listos.length; i += 50) {
    const lote = listos.slice(i, i + 50);
    const filas = lote.map((e) => ({ id: e.id, codigo: e.codigo, tipo: e.tipo, bin_id: e.bin_id, datos: e.datos, hecho_en: e.hecho_en, dispositivo: e.dispositivo, hecho_por: uid }));
    for (const f of filas) {
      const { error } = await supabase.from('eventos_bin').upsert(f, { onConflict: 'id', ignoreDuplicates: true });
      if (error) { errores.push(`Bin ${f.codigo}: ${error.message}`); return n; }
    }
    const { data } = await supabase.from('eventos_bin').select('id,resultado,mensaje').in('id', lote.map((e) => e.id));
    for (const e of lote) {
      const r = (data || []).find((x: any) => x.id === e.id);
      await db.eventos.update(e.id, { sync: 1, resultado: r?.resultado ?? null, mensaje: r?.mensaje ?? null, fotos_locales: [] });
    }
    n += lote.length;
  }
  return n;
}

/** Entrega que cuenta en los totales del teléfono (las anuladas o duplicadas no suman) */
export const vigente = (e: EntregaLocal) => !e.estado || e.estado === 'A';

/**
 * Trae del servidor las entregas de los últimos 7 días registradas por este usuario
 * y aplica en el teléfono las ediciones y anulaciones hechas por administración.
 */
export async function bajarEntregasPropias(): Promise<number> {
  const { data: u } = await supabase.auth.getUser();
  if (!u?.user) return 0;
  const desde = hoyISO(new Date(Date.now() - 7 * 86400000));
  const remotas = await traerTodo('entregas',
    'id,empresa_id,huerto_id,cuartel_id,variedad_id,envase_id,calidad_id,turno_id,contratista_id,cuadrilla_id,trabajador_id,codigo_credencial,codigo_caja,cantidad,kilos_estimados,leido_en,fecha,lat,lng,dispositivo,jefe_user_id,estado,editada,bin_id',
    (q) => q.eq('jefe_user_id', u.user.id).gte('fecha', desde));
  const trabajadores: any[] = (await getCache('trabajadores')) || [];
  const nombre = (id: string) => { const t = trabajadores.find((x) => x.id === id); return t ? `${t.nombres ?? ''} ${t.apellido_paterno ?? ''}`.trim() : ''; };
  let cambios = 0;
  await db.transaction('rw', db.entregas, async () => {
    for (const r of remotas) {
      const local = await db.entregas.get(r.id);
      if (local && local.sync === 0) continue; // aún no se sube: manda el teléfono
      const nueva: EntregaLocal = { ...(local || {}), ...r, cantidad: Number(r.cantidad), kilos_estimados: Number(r.kilos_estimados), trabajador_nombre: nombre(r.trabajador_id) || local?.trabajador_nombre, sync: 1 } as EntregaLocal;
      if (!local || local.cantidad !== nueva.cantidad || local.estado !== nueva.estado || local.cuartel_id !== nueva.cuartel_id ||
          local.trabajador_id !== nueva.trabajador_id || local.envase_id !== nueva.envase_id || local.fecha !== nueva.fecha) cambios++;
      await db.entregas.put(nueva);
    }
  });
  return cambios;
}

export type ResumenDescarga = { huertos: number; cuarteles: number; contratistas: number; trabajadores: number; credenciales: number };

/**
 * Sincronización bajo demanda: 1) sube lo registrado en el teléfono, 2) descarga todo de nuevo
 * (huertos, cuarteles en cosecha, contratistas, trabajadores, credenciales, bins), 3) trae correcciones de la nube.
 */
export async function sincronizar(onPaso?: (texto: string) => void) {
  supabase.rpc('equipo_conectado').then(() => {}, () => {}); // el panel ve cuándo se conectó el equipo
  onPaso?.('1 de 3 · Subiendo registros de cosecha…');
  const r = await subirPendientes();
  onPaso?.('2 de 3 · Descargando trabajadores, contratistas, huertos y cuarteles…');
  await descargarMaestros();
  onPaso?.('3 de 3 · Revisando cambios hechos en la nube…');
  let actualizadas = 0;
  try { actualizadas = await bajarEntregasPropias(); } catch {}
  const largo = async (k: string) => ((await getCache(k)) || []).length;
  const resumen: ResumenDescarga = {
    huertos: await largo('huertos'), cuarteles: await largo('cuarteles'), contratistas: await largo('contratistas'),
    trabajadores: await largo('trabajadores'), credenciales: await largo('credenciales'),
  };
  await setCache('resumen_descarga', resumen);
  onPaso?.('');
  return { ...r, actualizadas, resumen };
}

/** ¿Los datos del teléfono se descargaron hoy? */
export function datosDeHoy(ultimaDescarga: string | null | undefined) {
  return !!ultimaDescarga && hoyISO(new Date(ultimaDescarga)) === hoyISO();
}

export async function limpiarAntiguas() {
  // Conserva 7 días de entregas ya sincronizadas en el teléfono
  const limite = hoyISO(new Date(Date.now() - 7 * 86400000));
  await db.entregas.where('fecha').below(limite).and((e) => e.sync === 1).delete();
  await db.eventos.where('hecho_en').below(limite).and((e) => e.sync === 1).delete();
}
