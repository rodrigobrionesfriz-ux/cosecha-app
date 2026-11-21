import { normalizarRut, rutValido } from './util';

export type DatosCedula = {
  rut: string | null;
  serie: string | null;        // número de documento
  nacimiento: string | null;   // AAAA-MM-DD
  vencimiento: string | null;  // AAAA-MM-DD
  tipo: string | null;         // CEDULA, CEDULA_EXT, etc.
  texto: string;               // contenido completo del QR
};

function fecha(yymmdd: string, siglo: 'nacimiento' | 'vencimiento'): string | null {
  if (!/^\d{6}$/.test(yymmdd)) return null;
  const yy = Number(yymmdd.slice(0, 2)), mm = Number(yymmdd.slice(2, 4)), dd = Number(yymmdd.slice(4, 6));
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
  const actual = new Date().getFullYear() % 100;
  const anio = siglo === 'nacimiento' ? (yy > actual ? 1900 + yy : 2000 + yy) : 2000 + yy;
  return `${anio}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
}

/**
 * Lee el QR del carnet chileno (desde 2013). Es una URL del Registro Civil con:
 *   RUN=12345678-9 · type=CEDULA · serial=123456789 · mrz=<serial 9><nacimiento AAMMDD><dv><vencimiento AAMMDD><dv>
 * El QR no trae nombres: se escriben a mano (o se completan si el trabajador ya existe).
 * También acepta el código PDF417 de los carnets antiguos (solo se toma el RUN).
 */
export function leerCedula(texto: string): DatosCedula | null {
  const t = (texto || '').trim();
  const d: DatosCedula = { rut: null, serie: null, nacimiento: null, vencimiento: null, tipo: null, texto: t };
  const param = (k: string) => {
    const m = t.match(new RegExp(`[?&]${k}=([^&#\\s]*)`, 'i'));
    return m ? decodeURIComponent(m[1]) : null;
  };
  const run = param('RUN');
  if (run) {
    const r = normalizarRut(run);
    d.rut = rutValido(r) ? r : null;
    d.tipo = param('type');
    d.serie = param('serial');
    const mrz = (param('mrz') || '').replace(/\D/g, '');
    if (mrz.length >= 22) {
      if (!d.serie) d.serie = mrz.slice(0, 9);
      d.nacimiento = fecha(mrz.slice(9, 15), 'nacimiento');
      d.vencimiento = fecha(mrz.slice(16, 22), 'vencimiento');
    }
    return d.rut ? d : null;
  }
  // Carnet antiguo (PDF417): empieza con el RUN sin guión
  const m = t.toUpperCase().match(/^0*(\d{6,8}[0-9K])/);
  if (m && rutValido(m[1])) { d.rut = normalizarRut(m[1]); return d; }
  // RUT escrito o pegado
  if (/^[0-9.]{6,12}-?[0-9Kk]$/.test(t) && rutValido(t)) { d.rut = normalizarRut(t); return d; }
  return null;
}
