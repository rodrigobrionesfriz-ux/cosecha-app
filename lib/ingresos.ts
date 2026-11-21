import { formatearRut } from './util';

export type Ficha = {
  id: string; trabajador_id: string; rut: string; extranjero: boolean; nombres: string; apellido_paterno: string | null; apellido_materno: string | null;
  nombre_completo: string; contratista_id: string | null; contratista: string; contratista_rut: string | null; estado: string;
  fecha_ingreso: string; fecha_nacimiento: string | null; sexo: string | null; nacionalidad: string | null; mrz_texto: string | null; cedula_serie: string | null; cedula_vencimiento: string | null; qr_texto: string | null;
  direccion: string | null; comuna: string | null; contacto_nombre: string | null; contacto_parentesco: string | null; contacto_celular: string | null;
  observacion: string | null; registrado_por_nombre: string | null; created_at: string;
};

export const fechaCorta = (iso: string | null) => (iso ? `${iso.slice(8, 10)}-${iso.slice(5, 7)}-${iso.slice(0, 4)}` : '');
export const celularVisible = (c: string | null) => (c ? c.replace(/^\+569(\d{4})(\d{4})$/, '+56 9 $1 $2') : '');

/** Columnas del reporte (Excel y PDF) */
export const COLUMNAS: { t: string; v: (f: Ficha) => string; w: number }[] = [
  { t: 'Ingreso', v: (f) => fechaCorta(f.fecha_ingreso), w: 20 },
  { t: 'RUT', v: (f) => (f.extranjero ? f.rut : formatearRut(f.rut)), w: 22 },
  { t: 'Nombre', v: (f) => f.nombre_completo, w: 48 },
  { t: 'Nacimiento', v: (f) => fechaCorta(f.fecha_nacimiento), w: 20 },
  { t: 'Sexo', v: (f) => f.sexo || '', w: 9 },
  { t: 'N° documento', v: (f) => f.cedula_serie || '', w: 22 },
  { t: 'Vence carnet', v: (f) => fechaCorta(f.cedula_vencimiento), w: 20 },
  { t: 'Dirección', v: (f) => [f.direccion, f.comuna].filter(Boolean).join(', '), w: 52 },
  { t: 'Contacto', v: (f) => f.contacto_nombre || '', w: 34 },
  { t: 'Parentesco', v: (f) => f.contacto_parentesco || '', w: 20 },
  { t: 'Celular contacto', v: (f) => celularVisible(f.contacto_celular), w: 26 },
];

export function agruparPorContratista(fichas: Ficha[]) {
  const m = new Map<string, Ficha[]>();
  for (const f of fichas) { const l = m.get(f.contratista) || []; l.push(f); m.set(f.contratista, l); }
  return [...m.entries()].sort(([a], [b]) => (a === 'Propio' ? -1 : b === 'Propio' ? 1 : a.localeCompare(b)));
}

const nombreArchivo = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '');

/** Excel: una hoja con todos y una hoja por contratista */
export async function excelIngresos(fichas: Ficha[], titulo: string) {
  const XLSX = await import('xlsx');
  const libro = XLSX.utils.book_new();
  const hoja = (l: Ficha[], conContr: boolean) => {
    const filas = l.map((f) => {
      const o: Record<string, string> = {};
      COLUMNAS.forEach((c, i) => { o[c.t] = c.v(f); if (i === 2 && conContr) o['Contratista'] = f.contratista; });
      return o;
    });
    const h = XLSX.utils.json_to_sheet(filas);
    h['!cols'] = (conContr ? [...COLUMNAS.slice(0, 3), { w: 30 }, ...COLUMNAS.slice(3)] : COLUMNAS).map((c) => ({ wch: Math.round(c.w * 0.75) }));
    return h;
  };
  const grupos = agruparPorContratista(fichas);
  if (grupos.length > 1) XLSX.utils.book_append_sheet(libro, hoja(fichas, true), 'Todos');
  const usados = new Set<string>();
  for (const [c, l] of grupos) {
    let n = c.replace(/[\\/?*[\]:]/g, ' ').slice(0, 28) || 'Hoja';
    while (usados.has(n)) n = n.slice(0, 26) + '_' + usados.size;
    usados.add(n);
    XLSX.utils.book_append_sheet(libro, hoja(l, false), n);
  }
  XLSX.writeFile(libro, `${nombreArchivo(titulo)}.xlsx`);
}

/** PDF horizontal: una sección (página nueva) por contratista, lista para la carpeta de prevención */
export async function pdfIngresos(fichas: Ficha[], o: { titulo: string; empresa: string; rango: string }) {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'letter' });
  const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight(), M = 10;
  const total = COLUMNAS.reduce((a, c) => a + c.w, 0);
  const esc = (W - 2 * M) / total;
  const grupos = agruparPorContratista(fichas);
  const hoy = new Date().toLocaleDateString('es-CL');

  grupos.forEach(([contr, lista], gi) => {
    if (gi > 0) doc.addPage();
    let y = M;
    const cabecera = (cont: boolean) => {
      doc.setFont('helvetica', 'bold'); doc.setFontSize(13); doc.setTextColor(30, 51, 34);
      doc.text(`${o.titulo}${cont ? ' (cont.)' : ''}`, M, y + 5);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(90);
      doc.text(`${o.empresa} · ${o.rango} · emitido ${hoy}`, W - M, y + 5, { align: 'right' });
      y += 10;
      doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(150, 30, 45);
      const rut = lista[0]?.contratista_rut ? ` · RUT ${formatearRut(lista[0].contratista_rut)}` : '';
      doc.text(`Contratista: ${contr}${rut} · ${lista.length} trabajador(es)`, M, y + 4);
      y += 8;
      doc.setFillColor(30, 51, 34); doc.rect(M, y, W - 2 * M, 7, 'F');
      doc.setFontSize(7.5); doc.setTextColor(255);
      let x = M;
      for (const c of COLUMNAS) { doc.text(c.t, x + 1.2, y + 4.7); x += c.w * esc; }
      y += 7; doc.setTextColor(30); doc.setFont('helvetica', 'normal');
    };
    cabecera(false);
    lista.forEach((f, i) => {
      const celdas = COLUMNAS.map((c) => doc.splitTextToSize(c.v(f) || '', c.w * esc - 2.4) as string[]);
      const alto = Math.max(...celdas.map((l) => l.length)) * 3.4 + 2.6;
      if (y + alto > H - 12) { doc.addPage(); y = M; cabecera(true); }
      if (i % 2) { doc.setFillColor(245, 240, 230); doc.rect(M, y, W - 2 * M, alto, 'F'); }
      let x = M;
      celdas.forEach((l, ci) => { doc.text(l, x + 1.2, y + 3.6); x += COLUMNAS[ci].w * esc; });
      doc.setDrawColor(220); doc.line(M, y + alto, W - M, y + alto);
      y += alto;
    });
    // firmas
    if (y + 28 > H - 12) { doc.addPage(); y = M + 10; }
    y += 20;
    doc.setDrawColor(120);
    doc.line(M + 10, y, M + 90, y); doc.line(W - M - 90, y, W - M - 10, y);
    doc.setFontSize(8); doc.setTextColor(90);
    doc.text('Firma encargado(a) de prevención', M + 50, y + 4, { align: 'center' });
    doc.text(contr === 'Propio' ? 'Firma administración' : 'Firma contratista', W - M - 50, y + 4, { align: 'center' });
  });
  const n = doc.getNumberOfPages();
  for (let p = 1; p <= n; p++) {
    doc.setPage(p); doc.setFontSize(7.5); doc.setTextColor(140);
    doc.text(`Página ${p} de ${n}`, W - M, H - 5, { align: 'right' });
  }
  doc.save(`${nombreArchivo(o.titulo)}.pdf`);
}
