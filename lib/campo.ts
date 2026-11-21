'use client';
// Estado local de la app de terreno: maestros en caché + operaciones hechas sin señal.
import { db, getCache, setCache } from './offline';

export type Maestros = {
  huertos: any[]; cuarteles: any[]; variedades: any[]; especies: any[]; envases: any[];
  calidades: any[]; turnos: any[]; contratistas: any[]; cuadrillas: any[]; config_huerto: any[];
  trabajadores: any[]; credenciales: { codigo: string; trabajador_id: string }[];
  cajas_servidor: { codigo_caja: string; leido_en: string }[];
  bins_activos: import('./bins').BinServidor[];
  camaras: any[]; parametros_calidad: any[];
  ultima_descarga: string | null;
};

export type Dia = {
  huerto_id?: string; cuartel_id?: string; envase_id?: string; calidad_id?: string;
  turno_id?: string; contratista_id?: string; cuadrilla_id?: string;
};

export type Config = {
  modo_captura: 'credencial_cantidad' | 'credencial_caja';
  horas_bloqueo_caja: number; segundos_entre_lecturas: number; max_cajas_por_lectura: number;
  exige_calidad: boolean; exige_turno: boolean; exige_contratista: boolean; con_gps: boolean; permite_rut_extranjero: boolean;
  envase_id: string | null; calidad_id: string | null; hora_inicio_tarde: string;
  usa_bins: boolean; max_envases_bin: number; exige_calidad_recepcion: boolean;
};

export const CONFIG_DEF: Config = {
  modo_captura: 'credencial_cantidad', horas_bloqueo_caja: 12, segundos_entre_lecturas: 10, max_cajas_por_lectura: 10,
  exige_calidad: true, exige_turno: false, exige_contratista: false, con_gps: false, permite_rut_extranjero: true,
  envase_id: null, calidad_id: null, hora_inicio_tarde: '13:00',
  usa_bins: true, max_envases_bin: 24, exige_calidad_recepcion: false,
};

const sinTilde = (t: string) => (t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

/** Jornada según la hora de Chile: antes de hora_inicio_tarde es Mañana, después Tarde */
export function jornadaActual(m: Maestros, cfg: Config, fecha = new Date()): { id: string | null; nombre: string; esTarde: boolean } {
  const hm = new Intl.DateTimeFormat('es-CL', { timeZone: 'America/Santiago', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(fecha);
  const [h, mi] = hm.split(':').map(Number);
  const [ch, cm] = (cfg.hora_inicio_tarde || '13:00').split(':').map(Number);
  const esTarde = h * 60 + mi >= ch * 60 + (cm || 0);
  const t = m.turnos.find((x) => sinTilde(x.nombre).includes(esTarde ? 'tarde' : 'manana'));
  return { id: t?.id ?? null, nombre: t?.nombre ?? (esTarde ? 'Tarde' : 'Mañana'), esTarde };
}

export async function leerMaestros(): Promise<Maestros> {
  const k = ['huertos', 'cuarteles', 'variedades', 'especies', 'envases', 'calidades', 'turnos', 'contratistas', 'cuadrillas', 'config_huerto', 'trabajadores', 'credenciales', 'cajas_servidor', 'bins_activos', 'camaras', 'parametros_calidad', 'ultima_descarga'];
  const vals = await Promise.all(k.map((x) => getCache(x)));
  const m: any = {};
  k.forEach((x, i) => (m[x] = vals[i] ?? (x === 'ultima_descarga' ? null : [])));
  // solo huertos con al menos un cuartel habilitado para cosecha
  m.huertos = m.huertos.filter((h: any) => m.cuarteles.some((c: any) => c.huerto_id === h.id));
  // mezclar con lo creado en terreno sin señal
  const tLoc: any[] = (await getCache('trabajadores_locales')) || [];
  const cLoc: any[] = (await getCache('credenciales_locales')) || [];
  const ruts = new Set(m.trabajadores.map((t: any) => t.rut));
  m.trabajadores = [...m.trabajadores, ...tLoc.filter((t) => !ruts.has(t.rut))];
  // un trabajador con asignación local reemplaza su credencial del servidor
  const idsLoc = new Set(cLoc.map((c) => resolverId(c.trabajador_id, m.trabajadores)));
  const codLoc = new Set(cLoc.map((c) => c.codigo));
  m.credenciales = [
    ...m.credenciales.filter((c: any) => !codLoc.has(c.codigo) && !idsLoc.has(c.trabajador_id)),
    ...cLoc.map((c) => ({ ...c, trabajador_id: resolverId(c.trabajador_id, m.trabajadores) })),
  ];
  return m as Maestros;
}

/** 'local:12345678-9' → id real si el trabajador ya existe en el servidor */
function resolverId(id: string, trabajadores: any[]): string {
  if (!id.startsWith('local:')) return id;
  const rut = id.slice(6);
  const t = trabajadores.find((x) => x.rut === rut && !String(x.id).startsWith('local:'));
  return t ? t.id : id;
}

export async function registrarAsignacionLocal(codigo: string, trabajador: any) {
  // trabajador existente con contratista cambiado: se refleja altiro en el teléfono
  if (!String(trabajador.id).startsWith('local:')) {
    const ts: any[] = (await getCache('trabajadores')) || [];
    const i = ts.findIndex((t) => t.id === trabajador.id);
    if (i >= 0 && (ts[i].contratista_id ?? null) !== (trabajador.contratista_id ?? null)) {
      ts[i] = { ...ts[i], contratista_id: trabajador.contratista_id ?? null };
      await setCache('trabajadores', ts);
    }
  }
  const tLoc: any[] = (await getCache('trabajadores_locales')) || [];
  if (String(trabajador.id).startsWith('local:') && !tLoc.some((t) => t.rut === trabajador.rut)) {
    tLoc.push(trabajador);
    await setCache('trabajadores_locales', tLoc);
  }
  const cLoc: any[] = ((await getCache('credenciales_locales')) || []).filter((c: any) => c.codigo !== codigo && c.trabajador_id !== trabajador.id);
  cLoc.push({ codigo, trabajador_id: trabajador.id });
  await setCache('credenciales_locales', cLoc);
}

/** Después de sincronizar sin asignaciones pendientes, el servidor ya refleja todo */
export async function limpiarLocalesSiCorresponde() {
  const pend = await db.asignaciones.where('sync').equals(0).count();
  if (!pend) {
    await setCache('trabajadores_locales', []);
    await setCache('credenciales_locales', []);
  }
}

export function configDe(m: Maestros, huertoId?: string): Config {
  const c = m.config_huerto.find((x) => x.huerto_id === huertoId);
  return { ...CONFIG_DEF, ...(c || {}) };
}

export function nombreTrabajador(t: any): string {
  if (!t) return '';
  return `${t.nombres ?? ''} ${t.apellido_paterno ?? ''}`.trim();
}

export function leerDia(): Dia {
  try { return JSON.parse(localStorage.getItem('cosecha-dia-' + (localStorage.getItem('cosecha-usuario') || '')) || '{}'); } catch { return {}; }
}
export function guardarDia(d: Dia) {
  localStorage.setItem('cosecha-dia-' + (localStorage.getItem('cosecha-usuario') || ''), JSON.stringify(d));
}

export function faltantesDia(d: Dia, cfg: Config, m: Maestros): string[] {
  const f: string[] = [];
  if (!d.huerto_id || !m.huertos.some((x) => x.id === d.huerto_id)) f.push('huerto');
  if (!d.cuartel_id || !m.cuarteles.some((x) => x.id === d.cuartel_id && x.huerto_id === d.huerto_id)) f.push('cuartel');
  if (cfg.exige_contratista && m.contratistas.length && !d.contratista_id) f.push('contratista');
  return f;
}

/** Lo que define el administrador y falta (el jefe no lo puede corregir) */
export function faltantesAdmin(cfg: Config, m: Maestros): string[] {
  const f: string[] = [];
  if (!cfg.envase_id || !m.envases.some((x) => x.id === cfg.envase_id)) f.push('envase');
  if (m.calidades.length && (!cfg.calidad_id || !m.calidades.some((x) => x.id === cfg.calidad_id))) f.push('calidad');
  return f;
}
