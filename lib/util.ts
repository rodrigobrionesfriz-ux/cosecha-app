// ---------- RUT ----------
export function limpiarRut(rut: string): string {
  return (rut || '').toUpperCase().replace(/[^0-9K]/g, '');
}

export function rutValido(rut: string): boolean {
  const l = limpiarRut(rut);
  if (l.length < 2) return false;
  const cuerpo = l.slice(0, -1);
  const dv = l.slice(-1);
  if (!/^\d+$/.test(cuerpo)) return false;
  let suma = 0;
  let mult = 2;
  for (let i = cuerpo.length - 1; i >= 0; i--) {
    suma += parseInt(cuerpo[i], 10) * mult;
    mult = mult === 7 ? 2 : mult + 1;
  }
  const r = 11 - (suma % 11);
  const calc = r === 11 ? '0' : r === 10 ? 'K' : String(r);
  return calc === dv;
}

/** Formato de almacenamiento: 12345678-9 (sin puntos) */
export function normalizarRut(rut: string): string {
  const l = limpiarRut(rut);
  if (l.length < 2) return l;
  return `${l.slice(0, -1)}-${l.slice(-1)}`;
}

export function formatearRut(rut: string): string {
  const l = limpiarRut(rut);
  if (l.length < 2) return rut;
  const cuerpo = l.slice(0, -1).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${cuerpo}-${l.slice(-1)}`;
}

/** Extrae el RUN del QR del carnet chileno (URL con RUN=12345678-9) o acepta un RUT escrito */
export function rutDesdeQR(texto: string): string | null {
  const t = (texto || '').trim();
  const m = t.toUpperCase().match(/RUN=([0-9]{6,9}-?[0-9K])/);
  if (m) return normalizarRut(m[1]);
  if (/^[0-9.]{6,12}-?[0-9Kk]$/.test(t)) return normalizarRut(t);
  return null;
}

// ---------- Códigos QR propios ----------
// Formato: BC-<tipo>-<número>. Tipo W = credencial trabajador, B = caja
export type TipoCodigo = 'W' | 'B' | 'L';
export function tipoCodigo(texto: string): TipoCodigo | null {
  const m = (texto || '').trim().toUpperCase().match(/^BC-([WBL])-[0-9A-Z]{4,32}$/);
  return m ? (m[1] as TipoCodigo) : null;
}
export function normalizarCodigo(texto: string): string {
  return (texto || '').trim().toUpperCase();
}

// ---------- Fechas (hora de Chile) ----------
export function hoyISO(d = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(d);
}
export function horaCorta(iso: string): string {
  return new Date(iso).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Santiago' });
}
export function fechaCL(iso: string): string {
  if (!iso) return '';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}-${m}-${y}`;
}

export function uuid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export function num(n: number | string | null | undefined, dec = 0): string {
  const v = Number(n || 0);
  return v.toLocaleString('es-CL', { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

/** CSV con ; para que Excel en español lo abra bien */
export function descargarCSV(nombre: string, filas: Record<string, any>[]) {
  if (!filas.length) return;
  const cols = Object.keys(filas[0]);
  const esc = (v: any) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = '﻿' + [cols.join(';'), ...filas.map((f) => cols.map((c) => esc(f[c])).join(';'))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = nombre;
  a.click();
  URL.revokeObjectURL(a.href);
}

// ---------- Feedback en terreno ----------
export function vibrar(patron: number | number[]) {
  try { navigator.vibrate?.(patron); } catch {}
}
let audioCtx: AudioContext | null = null;
export function beep(ok = true) {
  try {
    audioCtx = audioCtx || new (window.AudioContext || (window as any).webkitAudioContext)();
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.frequency.value = ok ? 1200 : 300;
    o.connect(g); g.connect(audioCtx.destination);
    g.gain.value = 0.15;
    o.start();
    o.stop(audioCtx.currentTime + (ok ? 0.12 : 0.4));
  } catch {}
}
export function hablar(texto: string) {
  try {
    if (!('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(texto);
    u.lang = 'es-CL';
    u.rate = 1.1;
    window.speechSynthesis.speak(u);
  } catch {}
}
