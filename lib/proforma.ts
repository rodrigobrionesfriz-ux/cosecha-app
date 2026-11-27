import type { Fila } from './reportes';
import { fechaCL, formatearRut, num } from './util';

/** Todos los valores de cosecha son netos; la proforma agrega el IVA al final */
export const IVA = 0.19;

const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
export const nombreMes = (ym: string) => `${MESES[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;
export function rangoMes(ym: string) {
  const [a, m] = ym.split('-').map(Number);
  const fin = new Date(Date.UTC(a, m, 0)).getUTCDate();
  return { desde: `${ym}-01`, hasta: `${ym}-${String(fin).padStart(2, '0')}` };
}

type Montos = { totes: number; kilos: number; pagoTrab: number; comision: number; neto: number };
export type LineaVariedad = Montos & { variedad: string; pct: string };
export type LineaDia = Montos & { fecha: string; variedad: string; trabajadores: number };
export type Proforma = Montos & {
  empresa: string; empresaRut: string; contratista: string; rut: string; mes: string; variedades: string;
  lineas: LineaVariedad[]; dias: LineaDia[]; trabajadores: number; iva: number; total: number; ajustePacking: boolean;
};

const vacio = (): Montos => ({ totes: 0, kilos: 0, pagoTrab: 0, comision: 0, neto: 0 });
const sumar = (a: Montos, cant: number, kilos: number, pt: number, pc: number) => {
  a.totes += cant; a.kilos += kilos; a.pagoTrab += pt; a.comision += pc; a.neto += pt + pc;
};

/**
 * Una proforma por contratista con lo cosechado en el mes.
 * packing: kilos de packing por "fecha|huerto_id"; el factor se calcula sobre todo lo cosechado ese día en ese huerto.
 */
export function armarProformas(filas: Fila[], o: {
  empresa: string; empresaRut: string; mes: string; contratistaId: string; variedadIds: string[] | null; variedadesTxt: string;
  packing: Record<string, number>; rutContratista: Record<string, string>;
}): Proforma[] {
  const validas = filas.filter((f) => f.estado === 'A');
  const est: Record<string, number> = {};
  for (const f of validas) est[`${f.fecha}|${f.huerto_id}`] = (est[`${f.fecha}|${f.huerto_id}`] || 0) + Number(f.kilos_estimados);
  const factor = (f: Fila) => {
    const k = `${f.fecha}|${f.huerto_id}`;
    return o.packing[k] != null && est[k] > 0 ? o.packing[k] / est[k] : 1;
  };

  const sel = validas.filter((f) => f.contratista_id
    && (!o.contratistaId || f.contratista_id === o.contratistaId)
    && (!o.variedadIds || o.variedadIds.includes(f.variedad_id || '')));

  const grupos = new Map<string, Fila[]>();
  for (const f of sel) { const l = grupos.get(f.contratista_id!) || []; l.push(f); grupos.set(f.contratista_id!, l); }

  return [...grupos.entries()].map(([cid, l]) => {
    const tot = vacio();
    const porVar = new Map<string, LineaVariedad & { _p: Set<number> }>();
    const porDia = new Map<string, LineaDia & { _t: Set<string> }>();
    let ajuste = false;
    for (const f of l) {
      const cant = Number(f.cantidad), fac = factor(f), kilos = Number(f.kilos_estimados) * fac;
      if (fac !== 1) ajuste = true;
      const pt = Number(f.monto || 0), pc = Number(f.monto_recargo || 0);
      const v = f.variedad || 'Sin variedad';
      const lv = porVar.get(v) || { ...vacio(), variedad: v, pct: '', _p: new Set<number>() };
      sumar(lv, cant, kilos, pt, pc); if (Number(f.porcentaje_contratista)) lv._p.add(Number(f.porcentaje_contratista));
      porVar.set(v, lv);
      const kd = `${f.fecha}|${v}`;
      const ld = porDia.get(kd) || { ...vacio(), fecha: f.fecha, variedad: v, trabajadores: 0, _t: new Set<string>() };
      sumar(ld, cant, kilos, pt, pc); ld._t.add(f.trabajador_id);
      porDia.set(kd, ld);
      sumar(tot, cant, kilos, pt, pc);
    }
    const neto = Math.round(tot.neto);
    const iva = Math.round(neto * IVA);
    return {
      ...tot, neto, iva, total: neto + iva,
      empresa: o.empresa, empresaRut: o.empresaRut, contratista: l[0].contratista || 'Contratista', rut: o.rutContratista[cid] || '',
      mes: o.mes, variedades: o.variedadesTxt, trabajadores: new Set(l.map((f) => f.trabajador_id)).size, ajustePacking: ajuste,
      lineas: [...porVar.values()].map(({ _p, ...x }) => ({ ...x, pct: _p.size ? [..._p].map((p) => num(p, 1) + '%').join(' / ') : '0%' })).sort((a, b) => a.variedad.localeCompare(b.variedad)),
      dias: [...porDia.values()].map(({ _t, ...x }) => ({ ...x, trabajadores: _t.size })).sort((a, b) => (a.fecha + a.variedad).localeCompare(b.fecha + b.variedad)),
    };
  }).sort((a, b) => a.contratista.localeCompare(b.contratista));
}

const nombreArchivo = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '');
const pesos = (n: number) => '$' + num(Math.round(n));
const kg = (n: number) => num(n, 1);
type Col<T> = { t: string; w: number; v: (x: T) => string; der?: boolean };

export async function pdfProforma(p: Proforma) {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter' });
  const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight(), M = 12;
  const verde: [number, number, number] = [31, 74, 39], cereza: [number, number, number] = [142, 16, 39];
  let y = M;

  const encabezado = () => {
    doc.setFillColor(...verde); doc.rect(0, 0, W, 20, 'F');
    doc.setFillColor(179, 25, 47); doc.rect(0, 20, W, 1.2, 'F');
    doc.setTextColor(255); doc.setFont('helvetica', 'bold'); doc.setFontSize(13);
    doc.text(p.empresa, M, 9);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5);
    if (p.empresaRut) doc.text(`RUT ${formatearRut(p.empresaRut)}`, M, 14.5);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(15);
    doc.text('PROFORMA', W - M, 10, { align: 'right' });
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5);
    doc.text(`Servicio de cosecha · ${nombreMes(p.mes)}`, W - M, 15, { align: 'right' });
    y = 28;
  };
  const nuevaPagina = () => { doc.addPage(); encabezado(); };

  function tabla<T>(cols: Col<T>[], filas: T[], total?: string[]) {
    const ancho = W - 2 * M; const esc = ancho / cols.reduce((a, c) => a + c.w, 0);
    const cab = () => {
      doc.setFillColor(...verde); doc.rect(M, y, ancho, 6.5, 'F');
      doc.setFont('helvetica', 'bold'); doc.setFontSize(7.8); doc.setTextColor(255);
      let x = M;
      for (const c of cols) { const w = c.w * esc; doc.text(c.t, c.der ? x + w - 1.5 : x + 1.5, y + 4.4, { align: c.der ? 'right' : 'left' }); x += w; }
      y += 6.5; doc.setFont('helvetica', 'normal'); doc.setTextColor(30);
    };
    cab();
    const fila = (celdas: string[], i: number, negrita = false) => {
      const alto = 5.6;
      if (y + alto > H - 16) { nuevaPagina(); cab(); }
      if (negrita) { doc.setFillColor(227, 238, 216); doc.rect(M, y, ancho, alto, 'F'); doc.setFont('helvetica', 'bold'); }
      else if (i % 2) { doc.setFillColor(249, 244, 232); doc.rect(M, y, ancho, alto, 'F'); }
      doc.setFontSize(7.8);
      let x = M;
      cols.forEach((c, ci) => {
        const w = c.w * esc;
        const txt = (doc.splitTextToSize(celdas[ci] ?? '', w - 3) as string[])[0] || '';
        doc.text(txt, c.der ? x + w - 1.5 : x + 1.5, y + 3.9, { align: c.der ? 'right' : 'left' });
        x += w;
      });
      doc.setDrawColor(225); doc.line(M, y + alto, M + ancho, y + alto);
      doc.setFont('helvetica', 'normal');
      y += alto;
    };
    filas.forEach((f, i) => fila(cols.map((c) => c.v(f)), i));
    if (total) fila(total, 0, true);
    y += 5;
  }

  encabezado();
  // Cliente y proveedor
  const caja = (x: number, w: number, titulo: string, nombre: string, rut: string) => {
    doc.setDrawColor(230, 220, 198); doc.setFillColor(249, 244, 232); doc.roundedRect(x, y, w, 20, 2, 2, 'FD');
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(118, 105, 90);
    doc.text(titulo.toUpperCase(), x + 3, y + 5);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10.5); doc.setTextColor(43, 38, 32);
    doc.text((doc.splitTextToSize(nombre, w - 6) as string[])[0], x + 3, y + 11);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(90);
    doc.text(rut ? `RUT ${formatearRut(rut)}` : 'RUT no registrado', x + 3, y + 16.5);
  };
  const mitad = (W - 2 * M - 4) / 2;
  caja(M, mitad, 'Proveedor (contratista)', p.contratista, p.rut);
  caja(M + mitad + 4, mitad, 'Cliente', p.empresa, p.empresaRut);
  y += 25;

  doc.setFontSize(8.5); doc.setTextColor(60);
  const info = [
    `Período: ${nombreMes(p.mes)}`,
    `Variedades: ${p.variedades}`,
    `Trabajadores: ${num(p.trabajadores)} · Totes: ${num(p.totes)} · Kilos: ${kg(p.kilos)}${p.ajustePacking ? ' (ajustados a packing)' : ' (estimados)'}`,
    `Emitida: ${new Date().toLocaleDateString('es-CL')}`,
  ];
  info.forEach((t) => { doc.text(t, M, y); y += 4.6; });
  y += 2;

  doc.setFont('helvetica', 'bold'); doc.setFontSize(10.5); doc.setTextColor(...verde);
  doc.text('Resumen por variedad', M, y); y += 3;
  tabla<LineaVariedad>([
    { t: 'Variedad', w: 34, v: (l) => l.variedad }, { t: 'Totes', w: 16, v: (l) => num(l.totes), der: true },
    { t: 'Kilos', w: 20, v: (l) => kg(l.kilos), der: true }, { t: 'Pago trabajadores', w: 28, v: (l) => pesos(l.pagoTrab), der: true },
    { t: '% comisión', w: 18, v: (l) => l.pct, der: true }, { t: 'Comisión contratista', w: 28, v: (l) => pesos(l.comision), der: true },
    { t: 'Neto', w: 26, v: (l) => pesos(l.neto), der: true },
  ], p.lineas, ['TOTAL', num(p.totes), kg(p.kilos), pesos(p.pagoTrab), '', pesos(p.comision), pesos(p.neto)]);

  // Totales con IVA
  const bw = 78, bx = W - M - bw;
  if (y + 40 > H - 16) nuevaPagina();
  const filaTot = (l: string, v: string, fuerte = false) => {
    if (fuerte) { doc.setFillColor(...verde); doc.rect(bx, y - 1, bw, 8, 'F'); doc.setTextColor(255); doc.setFont('helvetica', 'bold'); doc.setFontSize(10.5); }
    else { doc.setTextColor(43, 38, 32); doc.setFont('helvetica', 'normal'); doc.setFontSize(9); }
    doc.text(l, bx + 3, y + 4.4); doc.text(v, bx + bw - 3, y + 4.4, { align: 'right' });
    if (!fuerte) { doc.setDrawColor(225); doc.line(bx, y + 7, bx + bw, y + 7); }
    y += 8;
  };
  filaTot('Pago a trabajadores', pesos(p.pagoTrab));
  filaTot('Comisión contratista', pesos(p.comision));
  filaTot('Subtotal neto', pesos(p.neto));
  filaTot(`IVA ${num(IVA * 100)}%`, pesos(p.iva));
  filaTot('TOTAL', pesos(p.total), true);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(118, 105, 90);
  doc.text('Valores de cosecha netos; el IVA se agrega al final.', bx, y + 3);
  y += 10;

  if (y + 20 > H - 16) nuevaPagina();
  doc.setFont('helvetica', 'bold'); doc.setFontSize(10.5); doc.setTextColor(...cereza);
  doc.text('Detalle por día', M, y); y += 3;
  tabla<LineaDia>([
    { t: 'Fecha', w: 20, v: (l) => fechaCL(l.fecha) }, { t: 'Variedad', w: 28, v: (l) => l.variedad },
    { t: 'Trab.', w: 12, v: (l) => num(l.trabajadores), der: true }, { t: 'Totes', w: 14, v: (l) => num(l.totes), der: true },
    { t: 'Kilos', w: 18, v: (l) => kg(l.kilos), der: true }, { t: 'Pago trabajadores', w: 26, v: (l) => pesos(l.pagoTrab), der: true },
    { t: 'Comisión', w: 24, v: (l) => pesos(l.comision), der: true }, { t: 'Neto', w: 24, v: (l) => pesos(l.neto), der: true },
  ], p.dias, ['TOTAL', '', '', num(p.totes), kg(p.kilos), pesos(p.pagoTrab), pesos(p.comision), pesos(p.neto)]);

  if (y + 26 > H - 16) nuevaPagina();
  y += 16;
  doc.setDrawColor(120);
  doc.line(M + 8, y, M + 78, y); doc.line(W - M - 78, y, W - M - 8, y);
  doc.setFontSize(8); doc.setTextColor(90);
  doc.text('Firma administración', M + 43, y + 4, { align: 'center' });
  doc.text('Firma contratista', W - M - 43, y + 4, { align: 'center' });

  const n = doc.getNumberOfPages();
  for (let i = 1; i <= n; i++) {
    doc.setPage(i); doc.setFontSize(7.5); doc.setTextColor(140);
    doc.text(`${p.contratista} · ${nombreMes(p.mes)} · QSecha`, M, H - 6);
    doc.text(`Página ${i} de ${n}`, W - M, H - 6, { align: 'right' });
  }
  doc.save(`${nombreArchivo(`Proforma ${p.contratista} ${p.mes}`)}.pdf`);
}
