'use client';
// Equipos (teléfonos registrados por IMEI) y operador del día (jefe u operador de acopio con PIN).
import { supabase } from './supabase';
import { hoyISO } from './util';

const URL_SB = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://rzttmdlefitpabegnfjd.supabase.co';
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'sb_publishable_B-T-rlzWANaLYylDZUVlgQ_xpq8cIl4';
const K_EQUIPO = 'qsecha-equipo';

export type EquipoLocal = { email: string; secreto: string; imei: string; nombre: string; tipo: 'campo' | 'acopio'; empresa: string; registrado_en: string };

export function equipoLocal(): EquipoLocal | null {
  try { return JSON.parse(localStorage.getItem(K_EQUIPO) || 'null'); } catch { return null; }
}

/** IMEI: 15 dígitos con verificador Luhn */
export function imeiValido(imei: string) {
  if (!/^\d{15}$/.test(imei)) return false;
  let s = 0;
  for (let i = 0; i < 15; i++) { let d = +imei[i]; if (i % 2) { d *= 2; if (d > 9) d -= 9; } s += d; }
  return s % 10 === 0;
}

function secretoNuevo() {
  const b = new Uint8Array(24);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

/** Registra el teléfono; queda pendiente hasta que administración lo apruebe */
export async function registrarEquipo(d: { imei: string; nombre: string; tipo: 'campo' | 'acopio'; empresa: string }) {
  const secreto = secretoNuevo();
  const r = await fetch(`${URL_SB}/functions/v1/registrar-equipo`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', apikey: ANON },
    body: JSON.stringify({ ...d, secreto, modelo: navigator.userAgent }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.ok) throw new Error(j.error || 'No se pudo registrar el equipo');
  const eq: EquipoLocal = { email: j.email, secreto, imei: d.imei, nombre: d.nombre, tipo: d.tipo, empresa: d.empresa, registrado_en: new Date().toISOString() };
  localStorage.setItem(K_EQUIPO, JSON.stringify(eq));
  await supabase.auth.signInWithPassword({ email: eq.email, password: eq.secreto });
  return j as { estado: string; empresa: string };
}

/** Inicia sesión con las credenciales guardadas del equipo (si hay señal) */
export async function entrarComoEquipo() {
  const eq = equipoLocal();
  if (!eq || !navigator.onLine) return false;
  const { error } = await supabase.auth.signInWithPassword({ email: eq.email, password: eq.secreto });
  return !error;
}

export async function estadoEquipo(): Promise<{ estado: string; nombre: string; tipo: string } | null> {
  const { data } = await supabase.from('equipos').select('estado,nombre,tipo').maybeSingle();
  return (data as any) || null;
}

export function olvidarEquipo() { localStorage.removeItem(K_EQUIPO); }

// ---------- Operador del día ----------
export type Operador = { id: string; nombre: string; rol: 'jefe' | 'acopio'; fecha: string };
const kOp = () => 'qsecha-operador-' + (localStorage.getItem('cosecha-usuario') || '');

export function operadorActual(): Operador | null {
  try {
    const o: Operador | null = JSON.parse(localStorage.getItem(kOp()) || 'null');
    return o && o.fecha === hoyISO() ? o : null;
  } catch { return null; }
}
export function fijarOperador(o: Omit<Operador, 'fecha'> | null) {
  if (!o) localStorage.removeItem(kOp());
  else localStorage.setItem(kOp(), JSON.stringify({ ...o, fecha: hoyISO() }));
}
/** Sufijo para separar datos del día y bin abierto por operador en un mismo teléfono */
export const claveOperador = () => operadorActual()?.id || '';

export async function pinCorrecto(op: { pin_sal?: string | null; pin_hash?: string | null }, pin: string) {
  if (!op.pin_sal || !op.pin_hash) return false;
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${op.pin_sal}:${pin}`));
  const hex = Array.from(new Uint8Array(buf), (x) => x.toString(16).padStart(2, '0')).join('');
  return hex === op.pin_hash;
}
