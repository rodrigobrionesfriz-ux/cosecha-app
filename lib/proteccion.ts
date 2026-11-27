'use client';
// Protección de lo registrado sin señal: almacenamiento persistente, antigüedad de lo
// pendiente y respaldo de emergencia a un archivo (se importa después desde el panel).
import { db, getCache, idDispositivo, usuarioActual } from './offline';

export type EstadoAlmacen = { persistente: boolean | null; usadoMB: number | null; libreMB: number | null };

/**
 * Pide a Chrome que no borre los datos de la app aunque el teléfono quede sin espacio.
 * Android lo concede solo si la app está instalada o se usa seguido; si no, queda en "best effort".
 */
export async function pedirPersistencia(): Promise<EstadoAlmacen> {
  const s: any = typeof navigator !== 'undefined' ? navigator.storage : null;
  if (!s?.persist) return { persistente: null, usadoMB: null, libreMB: null };
  let persistente = await s.persisted().catch(() => false);
  if (!persistente) persistente = await s.persist().catch(() => false);
  const est = await s.estimate?.().catch(() => null);
  const mb = (n?: number) => (n == null ? null : Math.round(n / 1048576));
  return { persistente, usadoMB: mb(est?.usage), libreMB: est?.quota != null && est?.usage != null ? mb(est.quota - est.usage) : null };
}

/** Fecha del registro sin subir más antiguo de este usuario (o null si no hay nada pendiente) */
export async function pendienteMasAntiguo(): Promise<string | null> {
  const uid = usuarioActual();
  const fechas: string[] = [];
  (await db.entregas.where('sync').equals(0).toArray()).filter((e) => e.jefe_user_id === uid).forEach((e) => fechas.push(e.leido_en));
  (await db.eventos.where('sync').equals(0).toArray()).filter((e) => e.usuario === uid).forEach((e) => fechas.push(e.hecho_en));
  (await db.asignaciones.where('sync').equals(0).toArray()).filter((a) => !a.usuario || a.usuario === uid).forEach((a) => fechas.push(a.creado_en));
  (await db.despachos.where('sync').equals(0).toArray()).filter((d) => d.usuario === uid).forEach((d) => fechas.push(d.abierto_en));
  return fechas.length ? fechas.sort()[0] : null;
}

/** Nivel de alerta según cuánto lleva sin subir: ok, aviso (más de 3 h) o urgente (más de 8 h) */
export function nivelAntiguedad(desde: string | null, ahora = Date.now()): 'ok' | 'aviso' | 'urgente' {
  if (!desde) return 'ok';
  const h = (ahora - new Date(desde).getTime()) / 3600000;
  return h >= 8 ? 'urgente' : h >= 3 ? 'aviso' : 'ok';
}

const aBase64 = (b: Blob) => new Promise<string>((ok, mal) => {
  const r = new FileReader();
  r.onload = () => ok(String(r.result).split(',')[1] || '');
  r.onerror = () => mal(r.error);
  r.readAsDataURL(b);
});

export type Respaldo = {
  tipo: 'qsecha-respaldo'; version: 1; creado_en: string; empresa_id: string; usuario: string; dispositivo: string; nombre: string;
  entregas: any[]; asignaciones: any[]; eventos: any[]; despachos: any[];
  destinos: { packings: any[]; plantas: any[] }; camiones: any[]; trabajadores_locales: any[];
};

/** Arma el respaldo con todo lo que este teléfono aún no sube (de cualquier usuario) */
export async function armarRespaldo(empresaId: string, nombre: string): Promise<Respaldo> {
  const entregas = (await db.entregas.where('sync').equals(0).toArray()).map(({ sync, error, ...e }) => e);
  const asignaciones = (await db.asignaciones.where('sync').equals(0).toArray()).map(({ sync, resultado, ...a }) => a);
  const eventos = [];
  for (const e of await db.eventos.where('sync').equals(0).toArray()) {
    const { sync, resultado, mensaje, fotos_locales, ...rest } = e;
    const fotos = [];
    for (const f of fotos_locales || []) fotos.push({ nombre: f.nombre, base64: await aBase64(f.blob) });
    eventos.push({ ...rest, fotos });
  }
  const despachos = (await db.despachos.where('sync').equals(0).toArray()).map(({ sync, ...d }) => d);
  const dest = (await getCache('destinos_locales')) || { packings: [], plantas: [] };
  return {
    tipo: 'qsecha-respaldo', version: 1, creado_en: new Date().toISOString(), empresa_id: empresaId,
    usuario: usuarioActual(), dispositivo: idDispositivo(), nombre,
    entregas, asignaciones, eventos, despachos,
    destinos: { packings: dest.packings.filter((x: any) => !x.sync), plantas: dest.plantas.filter((x: any) => !x.sync) },
    camiones: (await getCache('camiones_locales')) || [],
    trabajadores_locales: (await getCache('trabajadores_locales')) || [],
  };
}

export const totalRespaldo = (r: Respaldo) => r.entregas.length + r.asignaciones.length + r.eventos.length + r.despachos.length;

/** Guarda el respaldo como archivo: compartir (WhatsApp, correo, Drive) o descargar a la carpeta Descargas */
export async function descargarRespaldo(empresaId: string, nombre: string): Promise<{ total: number; via: 'compartido' | 'descargado' }> {
  const r = await armarRespaldo(empresaId, nombre);
  const fecha = new Date().toLocaleString('sv-SE', { timeZone: 'America/Santiago' }).replace(/[: ]/g, '-').slice(0, 16);
  const archivo = `respaldo-qsecha-${nombre.replace(/[^A-Za-z0-9]+/g, '_').slice(0, 30)}-${fecha}.json`;
  const blob = new Blob([JSON.stringify(r)], { type: 'application/json' });
  const file = new File([blob], archivo, { type: 'application/json' });
  const nav: any = navigator;
  if (nav.canShare?.({ files: [file] })) {
    try { await nav.share({ files: [file], title: 'Respaldo QSecha', text: `${totalRespaldo(r)} registro(s) sin subir` }); return { total: totalRespaldo(r), via: 'compartido' }; }
    catch (e: any) { if (e?.name === 'AbortError') throw new Error('Respaldo cancelado'); }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = archivo; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  return { total: totalRespaldo(r), via: 'descargado' };
}
