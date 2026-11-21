import { formatearRut, normalizarRut, rutValido } from './util';
import { leerCedula, DatosCedula } from './cedula';

export type DatosReverso = {
  rut: string | null;
  nombres: string; apellido_paterno: string; apellido_materno: string;
  sexo: 'M' | 'F' | null; nacionalidad: string | null;
  nacimiento: string | null; vencimiento: string | null; serie: string | null;
  qr: DatosCedula | null;
  mrz: string[] | null;          // las 3 líneas leídas
  verificado: boolean;           // dígitos verificadores de documento, nacimiento y vencimiento correctos
  avisos: string[];
};

const LIMPIO = /[^A-Z0-9<]/g;
const PARTICULAS = new Set(['DE', 'DEL', 'LA', 'LAS', 'LOS', 'SAN', 'SANTA', 'Y', 'VAN', 'VON', 'DA', 'DI']);

const titulo = (s: string) => s.toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase());

/** "PEREZ DE LA FUENTE SOTO" → ["Perez de la Fuente", "Soto"] agrupando partículas con la palabra que sigue */
function separarApellidos(ap: string): [string, string] {
  const w = ap.split(/\s+/).filter(Boolean);
  const grupos: string[] = [];
  let acum: string[] = [];
  for (const p of w) {
    acum.push(p);
    if (!PARTICULAS.has(p)) { grupos.push(acum.join(' ')); acum = []; }
  }
  if (acum.length) grupos.push(acum.join(' '));
  const f = (s: string) => titulo(s).replace(/\b(De|Del|La|Las|Los|Y)\b/g, (m) => m.toLowerCase());
  if (grupos.length <= 1) return [f(grupos[0] || ''), ''];
  return [f(grupos[0]), f(grupos.slice(1).join(' '))];
}

function fechaMRZ(yymmdd: string | null, tipo: 'n' | 'v'): string | null {
  if (!yymmdd || !/^\d{6}$/.test(yymmdd)) return null;
  const yy = +yymmdd.slice(0, 2), actual = new Date().getFullYear() % 100;
  const anio = tipo === 'n' ? (yy > actual ? 1900 + yy : 2000 + yy) : 2000 + yy;
  return `${anio}-${yymmdd.slice(2, 4)}-${yymmdd.slice(4, 6)}`;
}

/** Busca las 3 líneas TD1 (30 caracteres) en el texto reconocido */
export function buscarLineas(texto: string): string[] | null {
  const lineas = texto.toUpperCase().split('\n').map((l) => l.replace(/\s+/g, '').replace(LIMPIO, '')).filter((l) => l.length >= 24);
  const a30 = (l: string) => (l.length >= 30 ? l.slice(0, 30) : l.padEnd(30, '<'));
  // línea 1: después del N° de documento casi todo es relleno; un "<<<" leído como L, K o C se corrige
  const l1 = (l: string) => { const x = a30(l); return x.slice(0, 15) + x.slice(15).replace(/(?<=<)[LKC](?=<)/g, '<'); };
  for (let i = 0; i + 2 < lineas.length; i++) {
    if (/^[IAC][A-Z<]CHL|^I[A-Z<][A-Z<]{3}\d/.test(lineas[i]) && /^\d{6}/.test(lineas[i + 1])) {
      return [l1(lineas[i]), a30(lineas[i + 1]), a30(lineas[i + 2])];
    }
  }
  // respaldo: línea con fechas + la anterior y la siguiente
  for (let i = 1; i + 1 < lineas.length; i++) {
    if (/^\d{7}[MF<X]\d{7}[A-Z<]{3}/.test(lineas[i])) return [l1(lineas[i - 1]), a30(lineas[i]), a30(lineas[i + 1])];
  }
  return null;
}

async function interpretar(lineas: string[]) {
  const { parse } = await import('mrz');
  const r = parse(lineas, { autocorrect: true } as any);
  const ok = (campo: string) => r.details.find((d: any) => d.field === campo)?.valid !== false;
  return { r, verificado: ok('documentNumberCheckDigit') && ok('birthDateCheckDigit') && ok('expirationDateCheckDigit') };
}

function runDe(...txt: (string | null | undefined)[]): string | null {
  for (const t of txt) {
    const m = (t || '').toUpperCase().replace(/\s/g, '').match(/(\d{7,8})<?([0-9K])/);
    if (m && rutValido(m[1] + m[2])) return normalizarRut(m[1] + m[2]);
  }
  return null;
}

/** Imagen → canvas en escala de grises con contraste, opcionalmente rotada */
async function preparar(file: Blob, rot = 0): Promise<HTMLCanvasElement> {
  const bmp = await createImageBitmap(file);
  const esc = Math.min(1, 2000 / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * esc), h = Math.round(bmp.height * esc);
  const c = document.createElement('canvas');
  const girado = rot % 180 !== 0;
  c.width = girado ? h : w; c.height = girado ? w : h;
  const ctx = c.getContext('2d')!;
  ctx.translate(c.width / 2, c.height / 2); ctx.rotate((rot * Math.PI) / 180);
  ctx.drawImage(bmp, -w / 2, -h / 2, w, h);
  const img = ctx.getImageData(0, 0, c.width, c.height), d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    const v = Math.max(0, Math.min(255, (g - 128) * 1.6 + 128)); // más contraste
    d[i] = d[i + 1] = d[i + 2] = v;
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.putImageData(img, 0, 0);
  return c;
}

async function leerQR(file: File): Promise<DatosCedula | null> {
  try {
    const BD = (window as any).BarcodeDetector;
    if (BD) {
      const det = new BD({ formats: ['qr_code'] });
      const cod = await det.detect(await createImageBitmap(file));
      for (const x of cod) { const d = leerCedula(x.rawValue); if (d) return d; }
    }
  } catch {}
  try {
    const { Html5Qrcode } = await import('html5-qrcode');
    let div = document.getElementById('qr-archivo');
    if (!div) { div = document.createElement('div'); div.id = 'qr-archivo'; div.style.display = 'none'; document.body.appendChild(div); }
    const t = await new Html5Qrcode('qr-archivo').scanFile(file, false);
    return leerCedula(t);
  } catch { return null; }
}

/**
 * Lee la foto del reverso del carnet: las 3 líneas de lectura mecánica (nombres, sexo, nacimiento,
 * vencimiento, N° documento, RUN) y, si se ve, el QR como respaldo. Todo en el teléfono.
 */
export async function leerReverso(file: File, progreso?: (p: number, txt: string) => void): Promise<DatosReverso> {
  progreso?.(5, 'Buscando el QR…');
  const qr = await leerQR(file);
  progreso?.(15, 'Preparando lector de texto…');
  const { createWorker } = await import('tesseract.js');
  const worker = await createWorker('eng', 1, {
    logger: (m: any) => { if (m.status === 'recognizing text') progreso?.(20 + Math.round(m.progress * 70), 'Leyendo las líneas del carnet…'); },
  });
  let lineas: string[] | null = null;
  let res: Awaited<ReturnType<typeof interpretar>> | null = null;
  try {
    await worker.setParameters({ tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<', tessedit_pageseg_mode: '6' as any, preserve_interword_spaces: '0' } as any);
    for (const rot of [0, 90, 270, 180]) {
      const { data } = await worker.recognize(await preparar(file, rot));
      const l = buscarLineas(data.text);
      if (!l) continue;
      res = await interpretar(l); lineas = l;
      break; // en una orientación equivocada no aparecen las líneas
    }
  } finally { await worker.terminate(); }
  progreso?.(100, 'Listo');

  const avisos: string[] = [];
  const out: DatosReverso = {
    rut: qr?.rut ?? null, nombres: '', apellido_paterno: '', apellido_materno: '', sexo: null, nacionalidad: null,
    nacimiento: qr?.nacimiento ?? null, vencimiento: qr?.vencimiento ?? null, serie: qr?.serie ?? null,
    qr, mrz: lineas, verificado: !!res?.verificado, avisos,
  };
  if (res) {
    const f: any = res.r.fields;
    out.rut = out.rut ?? runDe(f.optional2, f.optional1, lineas?.[1], lineas?.[0]);
    const [ap, am] = separarApellidos((f.lastName || '').trim());
    out.apellido_paterno = ap; out.apellido_materno = am;
    out.nombres = titulo((f.firstName || '').trim());
    out.sexo = f.sex === 'male' ? 'M' : f.sex === 'female' ? 'F' : null;
    out.nacionalidad = f.nationality || null;
    if (res.verificado || !qr) {
      out.nacimiento = fechaMRZ(f.birthDate, 'n') ?? out.nacimiento;
      out.vencimiento = fechaMRZ(f.expirationDate, 'v') ?? out.vencimiento;
      out.serie = (f.documentNumber || '').replace(/</g, '') || out.serie;
    }
    if (!res.verificado) avisos.push('Algunos números no pasaron la verificación: revisa fechas y N° de documento, o toma otra foto.');
    avisos.push('Revisa los nombres: el carnet los trae sin tildes ni ñ y los muy largos pueden venir cortados.');
  } else {
    avisos.push(qr ? 'No pude leer las 3 líneas del carnet; tomé los datos del QR. Escribe nombres y sexo, o toma otra foto más cerca y sin reflejos.'
      : 'No pude leer el carnet. Toma la foto del reverso de frente, con buena luz, sin reflejos y con las 3 líneas <<< nítidas.');
  }
  if (out.rut) out.rut = normalizarRut(out.rut);
  return out;
}

export const rutLegible = (r: string | null) => (r ? formatearRut(r) : '');
