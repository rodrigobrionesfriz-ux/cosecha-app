import type { Fila } from './reportes';
import { fechaCL, formatearRut, num } from './util';

const hora24 = (iso: string) => new Intl.DateTimeFormat('es-CL', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/Santiago' }).format(new Date(iso));

/** Kilos de packing por huerto y factor de ajuste sobre los kilos estimados */
export type AjusteHuerto = { huerto_id: string; huerto: string; envases: number; estimado: number; packing: number | null; factor: number };

export type EntregaInf = {
  id: string; hora: string; leido_en: string; trabajador: string; rut: string; jefe: string; huerto: string; cuartel: string;
  variedad: string; envase: string; cantidad: number; kilos: number; pagoTrab: number; pagoContr: number; total: number;
};
export type TrabInf = { id: string; rut: string; nombre: string; entregas: number; totes: number; kilos: number; pagoTrab: number; pagoContr: number; total: number };
export type GrupoInf = {
  clave: string; contratista: string; rut: string; pct: string;
  trabajadores: TrabInf[]; entregas: EntregaInf[];
  totes: number; kilos: number; pagoTrab: number; pagoContr: number; total: number;
};
export type Informe = {
  empresa: string; empresaRut: string; fecha: string; huerto: string; ajustes: AjusteHuerto[];
  grupos: GrupoInf[]; tot: { trabajadores: number; entregas: number; totes: number; kilos: number; kilosEstimados: number; pagoTrab: number; pagoContr: number; total: number };
  duplicadas: number;
};

export const TITULO = 'Informe cosecha diaria';

/** Calcula los factores de packing por huerto (factor 1 si no hay dato de packing) */
export function calcularAjustes(filas: Fila[], packing: Record<string, number | null>): AjusteHuerto[] {
  const m = new Map<string, AjusteHuerto>();
  for (const f of filas) {
    if (f.estado !== 'A') continue;
    const a = m.get(f.huerto_id) || { huerto_id: f.huerto_id, huerto: f.huerto, envases: 0, estimado: 0, packing: null, factor: 1 };
    a.envases += Number(f.cantidad); a.estimado += Number(f.kilos_estimados);
    m.set(f.huerto_id, a);
  }
  return [...m.values()].map((a) => {
    const p = packing[a.huerto_id];
    const packingVal = p == null || isNaN(p) ? null : p;
    return { ...a, packing: packingVal, factor: packingVal != null && a.estimado > 0 ? packingVal / a.estimado : 1 };
  }).sort((a, b) => a.huerto.localeCompare(b.huerto));
}

export function armarInforme(filas: Fila[], o: {
  empresa: string; empresaRut: string; fecha: string; huerto: string; ajustes: AjusteHuerto[];
  rutContratista: Record<string, string>; contratista?: string;
}): Informe {
  const factor = Object.fromEntries(o.ajustes.map((a) => [a.huerto_id, a.factor]));
  const validas = filas.filter((f) => f.estado === 'A' && (!o.contratista || (f.contratista_id || 'propio') === o.contratista));
  const gm = new Map<string, GrupoInf & { _t: Map<string, TrabInf>; _p: Set<number> }>();
  for (const f of validas) {
    const k = f.contratista_id || 'propio';
    let g = gm.get(k);
    if (!g) {
      g = { clave: k, contratista: f.contratista || 'Propio / interno', rut: f.contratista_id ? (o.rutContratista[f.contratista_id] || '') : '', pct: '',
        trabajadores: [], entregas: [], totes: 0, kilos: 0, pagoTrab: 0, pagoContr: 0, total: 0, _t: new Map(), _p: new Set() };
      gm.set(k, g);
    }
    const cant = Number(f.cantidad);
    const kilos = Number(f.kilos_estimados) * (factor[f.huerto_id] ?? 1);
    const pt = Number(f.monto || 0), pc = Number(f.monto_recargo || 0), tot = Number(f.monto_total ?? pt + pc);
    g.entregas.push({ id: f.id, hora: hora24(f.leido_en), leido_en: f.leido_en, trabajador: f.trabajador, rut: f.rut, jefe: f.jefe || f.cuadrilla || '—',
      huerto: f.huerto, cuartel: f.cuartel, variedad: f.variedad || '', envase: f.envase, cantidad: cant, kilos, pagoTrab: pt, pagoContr: pc, total: tot });
    const t = g._t.get(f.trabajador_id) || { id: f.trabajador_id, rut: f.rut, nombre: f.trabajador, entregas: 0, totes: 0, kilos: 0, pagoTrab: 0, pagoContr: 0, total: 0 };
    t.entregas++; t.totes += cant; t.kilos += kilos; t.pagoTrab += pt; t.pagoContr += pc; t.total += tot;
    g._t.set(f.trabajador_id, t);
    g.totes += cant; g.kilos += kilos; g.pagoTrab += pt; g.pagoContr += pc; g.total += tot;
    if (Number(f.porcentaje_contratista)) g._p.add(Number(f.porcentaje_contratista));
  }
  const grupos = [...gm.values()].map(({ _t, _p, ...g }) => ({
    ...g,
    pct: _p.size ? [..._p].map((p) => num(p, 1) + '%').join(' / ') : (g.clave === 'propio' ? '—' : '0%'),
    trabajadores: [..._t.values()].sort((a, b) => a.nombre.localeCompare(b.nombre)),
    entregas: g.entregas.sort((a, b) => a.leido_en.localeCompare(b.leido_en)),
  })).sort((a, b) => (a.clave === 'propio' ? -1 : b.clave === 'propio' ? 1 : a.contratista.localeCompare(b.contratista)));

  const tot = grupos.reduce((t, g) => ({
    trabajadores: t.trabajadores + g.trabajadores.length, entregas: t.entregas + g.entregas.length, totes: t.totes + g.totes, kilos: t.kilos + g.kilos,
    kilosEstimados: t.kilosEstimados, pagoTrab: t.pagoTrab + g.pagoTrab, pagoContr: t.pagoContr + g.pagoContr, total: t.total + g.total,
  }), { trabajadores: 0, entregas: 0, totes: 0, kilos: 0, kilosEstimados: validas.reduce((s, f) => s + Number(f.kilos_estimados), 0), pagoTrab: 0, pagoContr: 0, total: 0 });
  const duplicadas = filas.filter((f) => f.estado === 'D' && (!o.contratista || (f.contratista_id || 'propio') === o.contratista)).length;
  return { empresa: o.empresa, empresaRut: o.empresaRut, fecha: o.fecha, huerto: o.huerto, ajustes: o.ajustes, grupos, tot, duplicadas };
}

const nombreArchivo = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '');
const archivo = (inf: Informe, sufijo = '') => nombreArchivo(`${TITULO} ${inf.fecha}${sufijo}`);
const pesos = (n: number) => '$' + num(n);
const kg = (n: number) => num(n, 1);

export function textoPacking(inf: Informe) {
  const con = inf.ajustes.filter((a) => a.packing != null);
  if (!con.length) return 'Kilos estimados (sin ajuste de packing)';
  return 'Kilos ajustados a packing: ' + inf.ajustes.map((a) => a.packing != null
    ? `${a.huerto} ${kg(a.packing)} kg (factor ${num(a.factor, 3)})`
    : `${a.huerto} sin dato de packing`).join(' · ');
}

/* ===================== Excel ===================== */
export async function excelInforme(inf: Informe) {
  const XLSX = await import('xlsx');
  const libro = XLSX.utils.book_new();
  const cab = [[inf.empresa], [inf.empresaRut ? `RUT ${formatearRut(inf.empresaRut)}` : ''], [TITULO], [`Fecha: ${fechaCL(inf.fecha)} · Huerto: ${inf.huerto}`], [textoPacking(inf)], []];

  const resumen = [...cab,
    ['Contratista', 'RUT', '% contratista', 'Trabajadores', 'Entregas', 'Totes', 'Kilos', 'Pago trabajadores $', 'Pago contratista $', 'Total $'],
    ...inf.grupos.map((g) => [g.contratista, g.rut ? formatearRut(g.rut) : '', g.pct, g.trabajadores.length, g.entregas.length, g.totes, round1(g.kilos), Math.round(g.pagoTrab), Math.round(g.pagoContr), Math.round(g.total)]),
    ['TOTAL', '', '', inf.tot.trabajadores, inf.tot.entregas, inf.tot.totes, round1(inf.tot.kilos), Math.round(inf.tot.pagoTrab), Math.round(inf.tot.pagoContr), Math.round(inf.tot.total)],
  ];
  const hr = XLSX.utils.aoa_to_sheet(resumen);
  hr['!cols'] = [30, 14, 12, 12, 10, 10, 12, 18, 18, 14].map((w) => ({ wch: w }));
  XLSX.utils.book_append_sheet(libro, hr, 'Resumen');

  const usados = new Set<string>(['Resumen']);
  for (const g of inf.grupos) {
    const filas: any[][] = [...cab,
      [`Contratista: ${g.contratista}${g.rut ? ' · RUT ' + formatearRut(g.rut) : ''} · ${g.pct}`], [],
      ['TRABAJADORES'],
      ['RUT', 'Trabajador', 'Entregas', 'Totes', 'Kilos', 'Pago trabajador $', 'Pago contratista $', 'Total $'],
      ...g.trabajadores.map((t) => [formatearRut(t.rut), t.nombre, t.entregas, t.totes, round1(t.kilos), Math.round(t.pagoTrab), Math.round(t.pagoContr), Math.round(t.total)]),
      ['TOTAL', '', g.entregas.length, g.totes, round1(g.kilos), Math.round(g.pagoTrab), Math.round(g.pagoContr), Math.round(g.total)],
      [],
      ['DETALLE DE ENTREGAS POR TOTE'],
      ['Hora', 'RUT', 'Trabajador', 'Jefe de cuadrilla', 'Huerto', 'Cuartel', 'Variedad', 'Cantidad', 'Kilos', 'Pago trabajador $', 'Pago contratista $', 'Total $'],
      ...g.entregas.map((e) => [e.hora, formatearRut(e.rut), e.trabajador, e.jefe, e.huerto, e.cuartel, e.variedad, e.cantidad, round1(e.kilos), Math.round(e.pagoTrab), Math.round(e.pagoContr), Math.round(e.total)]),
    ];
    const h = XLSX.utils.aoa_to_sheet(filas);
    h['!cols'] = [12, 30, 26, 22, 16, 16, 14, 10, 10, 16, 16, 12].map((w) => ({ wch: w }));
    let n = g.contratista.replace(/[\\/?*[\]:]/g, ' ').slice(0, 28) || 'Hoja';
    while (usados.has(n)) n = n.slice(0, 26) + '_' + usados.size;
    usados.add(n);
    XLSX.utils.book_append_sheet(libro, h, n);
  }
  XLSX.writeFile(libro, `${archivo(inf)}.xlsx`);
}
const round1 = (n: number) => Math.round(n * 10) / 10;

/* ===================== PDF ===================== */
type Col<T> = { t: string; w: number; v: (x: T) => string; der?: boolean };

export async function pdfInforme(inf: Informe) {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'letter' });
  const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight(), M = 10;
  const emitido = new Date().toLocaleString('es-CL', { dateStyle: 'short', timeStyle: 'short' });
  let y = M;

  const encabezado = () => {
    doc.setFillColor(31, 74, 39); doc.rect(0, 0, W, 18, 'F');
    doc.setFillColor(179, 25, 47); doc.rect(0, 18, W, 1.2, 'F');
    doc.setTextColor(255); doc.setFont('helvetica', 'bold'); doc.setFontSize(13);
    doc.text(inf.empresa, M, 8);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5);
    doc.text(inf.empresaRut ? `RUT ${formatearRut(inf.empresaRut)}` : '', M, 13.5);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(13);
    doc.text(TITULO.toUpperCase(), W - M, 8, { align: 'right' });
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5);
    doc.text(`${fechaCL(inf.fecha)} · Huerto: ${inf.huerto}`, W - M, 13.5, { align: 'right' });
    y = 25;
  };
  const nuevaPagina = () => { doc.addPage(); encabezado(); };
  const titulo = (t: string, color: [number, number, number] = [31, 74, 39]) => {
    if (y + 14 > H - 14) nuevaPagina();
    doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(...color);
    doc.text(t, M, y + 4); y += 7;
  };
  function tabla<T>(cols: Col<T>[], filas: T[], total?: string[]) {
    const ancho = W - 2 * M; const suma = cols.reduce((a, c) => a + c.w, 0); const esc = ancho / suma;
    const cabecera = () => {
      doc.setFillColor(31, 74, 39); doc.rect(M, y, ancho, 6.5, 'F');
      doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); doc.setTextColor(255);
      let x = M;
      for (const c of cols) { const w = c.w * esc; doc.text(c.t, c.der ? x + w - 1.2 : x + 1.2, y + 4.4, { align: c.der ? 'right' : 'left' }); x += w; }
      y += 6.5; doc.setFont('helvetica', 'normal'); doc.setTextColor(30);
    };
    cabecera();
    const fila = (celdas: string[], i: number, negrita = false) => {
      const alto = 5.2;
      if (y + alto > H - 14) { nuevaPagina(); cabecera(); }
      if (negrita) { doc.setFillColor(227, 238, 216); doc.rect(M, y, ancho, alto, 'F'); doc.setFont('helvetica', 'bold'); }
      else if (i % 2) { doc.setFillColor(249, 244, 232); doc.rect(M, y, ancho, alto, 'F'); }
      let x = M;
      cols.forEach((c, ci) => {
        const w = c.w * esc;
        const txt = (doc.splitTextToSize(celdas[ci] ?? '', w - 2.4) as string[])[0] || '';
        doc.text(txt, c.der ? x + w - 1.2 : x + 1.2, y + 3.6, { align: c.der ? 'right' : 'left' });
        x += w;
      });
      doc.setDrawColor(225); doc.line(M, y + alto, M + ancho, y + alto);
      doc.setFont('helvetica', 'normal');
      y += alto;
    };
    doc.setFontSize(7.5);
    filas.forEach((f, i) => fila(cols.map((c) => c.v(f)), i));
    if (total) fila(total, 0, true);
    y += 4;
  }

  // ---- Página 1: resumen ----
  encabezado();
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(90);
  const lineas = doc.splitTextToSize(textoPacking(inf), W - 2 * M) as string[];
  doc.text(lineas, M, y + 3); y += lineas.length * 4 + 3;

  // tarjetas de totales
  const cajas: [string, string][] = [
    ['Trabajadores', num(inf.tot.trabajadores)], ['Totes', num(inf.tot.totes)], ['Kilos', kg(inf.tot.kilos)],
    ['Pago trabajadores', pesos(inf.tot.pagoTrab)], ['Pago contratistas', pesos(inf.tot.pagoContr)], ['TOTAL A PAGAR', pesos(inf.tot.total)],
  ];
  const cw = (W - 2 * M - 5 * 3) / 6;
  cajas.forEach(([l, v], i) => {
    const x = M + i * (cw + 3); const fin = i === cajas.length - 1;
    doc.setFillColor(...((fin ? [227, 238, 216] : [249, 244, 232]) as [number, number, number])); doc.setDrawColor(...((fin ? [47, 107, 58] : [230, 220, 198]) as [number, number, number]));
    doc.roundedRect(x, y, cw, 15, 2, 2, 'FD');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.setTextColor(...((fin ? [31, 74, 39] : [43, 38, 32]) as [number, number, number]));
    doc.text(v, x + 3, y + 7);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(118, 105, 90);
    doc.text(l, x + 3, y + 12);
  });
  y += 21;

  titulo('Resumen de pagos por contratista');
  tabla<GrupoInf>([
    { t: 'Contratista', w: 50, v: (g) => g.contratista }, { t: 'RUT', w: 22, v: (g) => (g.rut ? formatearRut(g.rut) : '') },
    { t: '% contr.', w: 14, v: (g) => g.pct, der: true }, { t: 'Trab.', w: 12, v: (g) => num(g.trabajadores.length), der: true },
    { t: 'Totes', w: 14, v: (g) => num(g.totes), der: true }, { t: 'Kilos', w: 18, v: (g) => kg(g.kilos), der: true },
    { t: 'Pago trabajadores', w: 26, v: (g) => pesos(g.pagoTrab), der: true }, { t: 'Pago contratista', w: 26, v: (g) => pesos(g.pagoContr), der: true },
    { t: 'Total', w: 24, v: (g) => pesos(g.total), der: true },
  ], inf.grupos, ['TOTAL', '', '', num(inf.tot.trabajadores), num(inf.tot.totes), kg(inf.tot.kilos), pesos(inf.tot.pagoTrab), pesos(inf.tot.pagoContr), pesos(inf.tot.total)]);
  if (inf.duplicadas) {
    doc.setFontSize(8); doc.setTextColor(154, 91, 0);
    doc.text(`${inf.duplicadas} lectura(s) duplicada(s) por revisar quedaron fuera de este informe.`, M, y); y += 5;
  }

  // ---- Una sección por contratista ----
  for (const g of inf.grupos) {
    nuevaPagina();
    titulo(`${g.contratista}${g.rut ? ' · RUT ' + formatearRut(g.rut) : ''} · ${g.pct}`, [142, 16, 39]);
    titulo('Trabajadores');
    tabla<TrabInf>([
      { t: 'RUT', w: 22, v: (t) => formatearRut(t.rut) }, { t: 'Trabajador', w: 62, v: (t) => t.nombre },
      { t: 'Entregas', w: 14, v: (t) => num(t.entregas), der: true }, { t: 'Totes', w: 14, v: (t) => num(t.totes), der: true },
      { t: 'Kilos', w: 16, v: (t) => kg(t.kilos), der: true }, { t: 'Pago trabajador', w: 24, v: (t) => pesos(t.pagoTrab), der: true },
      { t: 'Pago contratista', w: 24, v: (t) => pesos(t.pagoContr), der: true }, { t: 'Total', w: 22, v: (t) => pesos(t.total), der: true },
    ], g.trabajadores, ['TOTAL', `${g.trabajadores.length} trabajador(es)`, num(g.entregas.length), num(g.totes), kg(g.kilos), pesos(g.pagoTrab), pesos(g.pagoContr), pesos(g.total)]);

    titulo('Detalle de entregas por tote');
    tabla<EntregaInf>([
      { t: 'Hora', w: 10, v: (e) => e.hora }, { t: 'RUT', w: 19, v: (e) => formatearRut(e.rut) }, { t: 'Trabajador', w: 44, v: (e) => e.trabajador },
      { t: 'Jefe de cuadrilla', w: 32, v: (e) => e.jefe }, { t: 'Cuartel', w: 22, v: (e) => e.cuartel }, { t: 'Variedad', w: 16, v: (e) => e.variedad },
      { t: 'Cant.', w: 9, v: (e) => num(e.cantidad, e.cantidad % 1 ? 1 : 0), der: true }, { t: 'Kilos', w: 12, v: (e) => kg(e.kilos), der: true },
      { t: 'Pago trab.', w: 16, v: (e) => pesos(e.pagoTrab), der: true }, { t: 'Pago contr.', w: 16, v: (e) => pesos(e.pagoContr), der: true },
      { t: 'Total', w: 16, v: (e) => pesos(e.total), der: true },
    ], g.entregas, ['', '', 'TOTAL', '', '', '', num(g.totes), kg(g.kilos), pesos(g.pagoTrab), pesos(g.pagoContr), pesos(g.total)]);

    if (y + 26 > H - 14) nuevaPagina();
    y += 16;
    doc.setDrawColor(120);
    doc.line(M + 10, y, M + 90, y); doc.line(W - M - 90, y, W - M - 10, y);
    doc.setFontSize(8); doc.setTextColor(90);
    doc.text('Firma administración', M + 50, y + 4, { align: 'center' });
    doc.text(g.clave === 'propio' ? 'Firma jefe de campo' : 'Firma contratista', W - M - 50, y + 4, { align: 'center' });
  }

  const n = doc.getNumberOfPages();
  for (let p = 1; p <= n; p++) {
    doc.setPage(p); doc.setFontSize(7.5); doc.setTextColor(140);
    doc.text(`Emitido ${emitido} · QSecha`, M, H - 5);
    doc.text(`Página ${p} de ${n}`, W - M, H - 5, { align: 'right' });
  }
  doc.save(`${archivo(inf)}.pdf`);
}
