'use client';
// Bins: estado combinado (servidor + movimientos hechos sin señal) y registro de movimientos.
import { db, EventoLocal, getCache, idDispositivo, setCache, usuarioActual } from './offline';
import { uuid } from './util';
import { claveOperador, operadorActual } from './equipo';

export type BinServidor = {
  id: string; codigo: string; estado: string; origen: string; huerto_id: string | null; cuartel_id: string | null; abierto_por: string | null; abierto_por_nombre: string | null;
  huerto: string | null; cuartel: string | null; variedad: string | null; cuadrilla: string | null;
  envases: number; kilos: number; abierto_en: string | null; cerrado_en: string | null; recibido_en: string | null;
  camara_id: string | null; camara: string | null; camara_inicio: string | null; minutos_alerta: number | null; minutos_objetivo: number | null;
  despacho_id: string | null;
};

export type BinActual = {
  codigo: string;
  id: string | null;
  estado: 'abierto' | 'cerrado' | 'recibido' | 'en_camara' | 'enfriado' | null; // null = libre (sin vuelta activa)
  abierto_por: string | null;
  camara_id: string | null;
  camara_inicio: string | null;
  servidor?: BinServidor;
};

export const ESTADOS_BIN: Record<string, string> = {
  abierto: 'Abierto en campo', cerrado: 'Cerrado en campo', recibido: 'Recibido en acopio',
  en_camara: 'En cámara', enfriado: 'Enfriado', despachado: 'Despachado', anulado: 'Anulado',
};

/** Estado de un bin según lo último que bajó del servidor más los movimientos locales posteriores */
export async function estadoBin(codigo: string): Promise<BinActual> {
  const bins: BinServidor[] = (await getCache('bins_activos')) || [];
  const ult: string = (await getCache('ultima_descarga')) || '';
  const s = bins.find((b) => b.codigo === codigo);
  const b: BinActual = s
    ? { codigo, id: s.id, estado: s.estado as any, abierto_por: s.abierto_por, camara_id: s.camara_id, camara_inicio: s.camara_inicio, servidor: s }
    : { codigo, id: null, estado: null, abierto_por: null, camara_id: null, camara_inicio: null };
  const locales = (await db.eventos.where('codigo').equals(codigo).sortBy('hecho_en'))
    .filter((e) => e.sync === 0 || e.hecho_en > ult)
    .filter((e) => !e.resultado || e.resultado === 'OK');
  for (const e of locales) aplicar(b, e);
  return b;
}

function aplicar(b: BinActual, e: EventoLocal) {
  switch (e.tipo) {
    case 'abrir': b.estado = 'abierto'; b.id = e.bin_id; b.abierto_por = e.usuario; break;
    case 'cerrar': if (b.estado === 'abierto') b.estado = 'cerrado'; break;
    case 'armar': b.estado = 'recibido'; b.id = e.bin_id; break;
    case 'recibir': b.estado = 'recibido'; if (!b.id) b.id = e.bin_id; break;
    case 'camara_entrada': b.estado = 'en_camara'; b.camara_id = e.datos?.camara_id ?? null; b.camara_inicio = e.hecho_en; break;
    case 'camara_salida': b.estado = 'enfriado'; break;
    case 'despachar': b.estado = null; b.id = null; break;
  }
}

export async function registrarEvento(tipo: EventoLocal['tipo'], codigo: string, datos: any = {}, binId: string | null = null, fotos?: { nombre: string; blob: Blob }[]) {
  const e: EventoLocal = {
    id: uuid(), codigo, tipo, bin_id: binId, datos: { ...datos, operador_id: operadorActual()?.id ?? null }, hecho_en: new Date().toISOString(),
    dispositivo: idDispositivo(), usuario: usuarioActual(), fotos_locales: fotos, sync: 0,
  };
  await db.eventos.add(e);
  return e;
}

// ---------- Bin abierto del jefe en este teléfono ----------
export type BinAbierto = { id: string; codigo: string; abierto_en: string; huerto_id: string; cuartel_id: string };

const claveBin = () => 'bin_abierto_' + usuarioActual() + (claveOperador() ? '_' + claveOperador() : '');
export async function leerBinAbierto(): Promise<BinAbierto | null> { return (await getCache(claveBin())) || null; }
export async function guardarBinAbierto(b: BinAbierto | null) { await setCache(claveBin(), b); }

/** Envases registrados en un bin desde este teléfono */
export async function envasesEnBin(binId: string): Promise<number> {
  const l = await db.entregas.where('bin_id').equals(binId).toArray();
  return l.filter((e) => !e.estado || e.estado === 'A').reduce((s, e) => s + Number(e.cantidad), 0);
}

/** Movimientos rechazados por el servidor en los últimos días (para avisar en pantalla) */
export async function eventosRechazados(dias = 2) {
  const desde = new Date(Date.now() - dias * 86400000).toISOString();
  const uid = usuarioActual();
  return (await db.eventos.where('hecho_en').above(desde).toArray())
    .filter((e) => e.usuario === uid && e.sync === 1 && e.resultado && e.resultado !== 'OK')
    .sort((a, b) => b.hecho_en.localeCompare(a.hecho_en));
}

export const TEXTO_EVENTO: Record<string, string> = {
  abrir: 'Abrir bin', cerrar: 'Cerrar bin', armar: 'Armar bin', recibir: 'Recepción',
  camara_entrada: 'Entrada a cámara', camara_salida: 'Salida de cámara', despachar: 'Despacho',
};
