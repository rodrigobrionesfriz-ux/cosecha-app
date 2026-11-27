'use client';
import { useEffect, useMemo, useState } from 'react';
import QRCode from 'qrcode';
import { cargarTabla } from '@/lib/datos';
import { useAuth } from '@/lib/auth';
import { formatearRut } from '@/lib/util';
import { logoUrl } from '@/lib/empresa';

const ESLOGAN = ['COSECHA', '+TRANSPARENTE'];

type Item = { codigo: string; tipo: string; numero?: number; nombre?: string; rut?: string; qr?: string };

// Formatos de impresión
const FORMATOS: Record<string, { t: string; w: number; h: number; page: string; cols: number; rows: number; margen: number; tipos: string }> = {
  credencialv: { t: 'Credencial vertical PVC 54×86 mm (9 por hoja A4)', w: 54, h: 85.6, page: 'A4', cols: 3, rows: 3, margen: 10, tipos: 'W' },
  credencial: { t: 'Credencial horizontal 85×54 mm (10 por hoja A4)', w: 85.6, h: 54, page: 'A4', cols: 2, rows: 5, margen: 10, tipos: 'W' },
  tarjabin: { t: 'Tarja de bin 95×65 mm (8 por hoja A4)', w: 95, h: 65, page: 'A4', cols: 2, rows: 4, margen: 10, tipos: 'L' },
  tarjabingrande: { t: 'Tarja de bin grande 190×130 mm (2 por hoja A4)', w: 190, h: 130, page: 'A4', cols: 1, rows: 2, margen: 10, tipos: 'L' },
  termica5840bin: { t: 'Térmica 58×40 mm · tarja de bin', w: 58, h: 40, page: '58mm 40mm', cols: 1, rows: 1, margen: 0, tipos: 'L' },
  etiqueta: { t: 'Etiqueta 50×30 mm (24 por hoja A4)', w: 50, h: 30, page: 'A4', cols: 4, rows: 8, margen: 6, tipos: 'WB' },
  termica5830qr: { t: 'Térmica 58×30 mm · solo QR + código (para PVC)', w: 58, h: 30, page: '58mm 30mm', cols: 1, rows: 1, margen: 0, tipos: 'WB' },
  termica5030: { t: 'Impresora térmica rollo 50×30 mm', w: 50, h: 30, page: '50mm 30mm', cols: 1, rows: 1, margen: 0, tipos: 'WB' },
  termica4030: { t: 'Impresora térmica rollo 40×30 mm', w: 40, h: 30, page: '40mm 30mm', cols: 1, rows: 1, margen: 0, tipos: 'WB' },
};
const DEFECTO: Record<string, string> = { W: 'credencialv', B: 'etiqueta', L: 'tarjabin' };
const claveFormato = (tipo?: string) => 'cosecha-formato-imp-' + (tipo || 'W');
/** Número corto del bin para leer a distancia: correlativo o últimos dígitos del código */
const numeroBin = (it: Item) => String(it.numero ?? Number(it.codigo.replace(/\D/g, '').slice(-6)));

export default function Imprimir() {
  const { perfil } = useAuth();
  const [items, setItems] = useState<Item[]>([]);
  const [formato, setFormatoState] = useState('credencial');
  const setFormato = (v: string) => { setFormatoState(v); try { localStorage.setItem(claveFormato(items[0]?.tipo), v); } catch {} };
  const [cargando, setCargando] = useState(true);
  const [conNombre, setConNombre] = useState(true);

  useEffect(() => {
    if (!perfil) return;
    (async () => {
      const p = new URLSearchParams(location.search);
      const lote = p.get('lote');
      let codigos = p.get('codigos')?.split(',').filter(Boolean) || [];
      const ses = p.get('sesion') ? JSON.parse(sessionStorage.getItem('imprimir-codigos') || '[]') : [];
      if (ses.length) codigos = ses;
      const sel = 'codigo,tipo,correlativo,trabajador:trabajadores(rut,nombres,apellido_paterno,apellido_materno)';
      let filas: any[] = [];
      if (lote) filas = await cargarTabla('tarjetas', sel, (q) => q.eq('lote_id', lote), 'codigo');
      else if (codigos.length) {
        for (let i = 0; i < codigos.length; i += 200) {
          filas.push(...(await cargarTabla('tarjetas', sel, (q) => q.in('codigo', codigos.slice(i, i + 200)), 'codigo')));
        }
      }
      const lista: Item[] = await Promise.all(
        filas.map(async (f) => ({
          codigo: f.codigo,
          tipo: f.tipo,
          numero: f.correlativo ?? undefined,
          nombre: f.trabajador ? `${f.trabajador.nombres} ${f.trabajador.apellido_paterno || ''} ${f.trabajador.apellido_materno || ''}`.trim() : undefined,
          rut: f.trabajador?.rut,
          qr: await QRCode.toDataURL(f.codigo, { errorCorrectionLevel: 'M', margin: 0, width: 400 }),
        }))
      );
      setItems(lista);
      const tipo = lista[0]?.tipo || 'W';
      const guardado = (() => { try { return localStorage.getItem(claveFormato(tipo)); } catch { return null; } })();
      setFormatoState(guardado && FORMATOS[guardado]?.tipos.includes(tipo) ? guardado : DEFECTO[tipo] || 'etiqueta');
      setCargando(false);
    })();
  }, [perfil]);

  const [exportando, setExportando] = useState('');

  /** PDF con una página por etiqueta (58×30 mm): QR + código. Para abrir en la app de la impresora (OpenLabel). */
  async function descargarPDF() {
    setExportando('Generando PDF…');
    try {
      const { jsPDF } = await import('jspdf');
      if (esBin) {
        const W = 58, H = 40, Q = 27;
        const doc = new jsPDF({ unit: 'mm', format: [W, H], orientation: 'landscape' });
        items.forEach((it, i) => {
          if (i > 0) doc.addPage([W, H], 'landscape');
          doc.addImage(it.qr!, 'PNG', 2, (H - Q) / 2 - 2, Q, Q);
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(8); doc.text('BIN', 31, 9);
          doc.setFontSize(numeroBin(it).length > 4 ? 18 : 24); doc.text(numeroBin(it), 31, 19);
          doc.setFontSize(6); doc.setFont('helvetica', 'normal'); doc.text(empresa, 31, 25, { maxWidth: 25 });
          doc.setFont('courier', 'bold'); doc.setFontSize(7.5);
          doc.text(it.codigo, W / 2, H - 2.2, { align: 'center' });
        });
        doc.save(`tarjas_bin_58x40_${items.length}.pdf`);
        setExportando('');
        return;
      }
      const W = 58, H = 30, Q = 22.5;
      const doc = new jsPDF({ unit: 'mm', format: [W, H], orientation: 'landscape' });
      items.forEach((it, i) => {
        if (i > 0) doc.addPage([W, H], 'landscape');
        doc.addImage(it.qr!, 'PNG', (W - Q) / 2, 1.2, Q, Q);
        doc.setFont('courier', 'bold');
        doc.setFontSize(9);
        doc.text(it.codigo, W / 2, 27.6, { align: 'center' });
      });
      doc.save(`credenciales_58x30_${items.length}.pdf`);
    } catch (e: any) { alert('No se pudo generar el PDF: ' + e.message); }
    setExportando('');
  }

  /** Excel con los códigos, para importar en OpenLabel y armar la etiqueta en lote. */
  async function descargarExcel() {
    setExportando('Generando Excel…');
    try {
      const XLSX = await import('xlsx');
      const filas = items.map((it) => ({ codigo: it.codigo, nombre: it.nombre ?? '', rut: it.rut ?? '' }));
      const hoja = XLSX.utils.json_to_sheet(filas);
      hoja['!cols'] = [{ wch: 22 }, { wch: 30 }, { wch: 14 }];
      const libro = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(libro, hoja, 'Credenciales');
      XLSX.writeFile(libro, `credenciales_${items.length}.xlsx`);
    } catch (e: any) { alert('No se pudo generar el Excel: ' + e.message); }
    setExportando('');
  }

  const f = FORMATOS[formato];
  const porHoja = f.cols * f.rows;
  const hojas = useMemo(() => {
    const out: Item[][] = [];
    for (let i = 0; i < items.length; i += porHoja) out.push(items.slice(i, i + porHoja));
    return out;
  }, [items, porHoja]);

  const empresa = perfil?.empresa?.nombre?.replace('Sociedad Agrícola y Forestal ', '').replace(' Ltda.', '') || '';
  const logoEmpresa = logoUrl(perfil?.empresa);
  const nombreEmpresa = perfil?.empresa?.nombre_corto || empresa;
  const esTermica = formato.startsWith('termica');
  const esBin = items[0]?.tipo === 'L';
  const tipoActual = items[0]?.tipo || 'W';

  return (
    <div style={{ background: '#e9ece9', minHeight: '100vh' }}>
      <style>{`
        @page { size: ${f.page}; margin: ${esTermica ? 0 : f.margen + 'mm'}; }
        .hoja { background:#fff; margin: 12px auto; padding: ${esTermica ? 0 : f.margen}mm; width: ${esTermica ? f.w + 'mm' : '210mm'};
                display: grid; grid-template-columns: repeat(${f.cols}, ${f.w}mm); grid-auto-rows: ${f.h}mm; gap: ${esTermica ? 0 : '0'};
                justify-content: center; box-shadow: 0 1px 4px rgba(0,0,0,.15); }
        .item { width:${f.w}mm; height:${f.h}mm; overflow:hidden; position:relative; outline: 0.2mm dashed #bbb; }
        .cred { display:flex; flex-direction:column; font-family: system-ui, sans-serif; }
        .cred .banda { background:#1f4a27; color:#fff; font-size:8pt; font-weight:700; padding:1.6mm 3mm; display:flex; justify-content:space-between; }
        .cred .cuerpo { flex:1; display:flex; align-items:center; gap:3mm; padding:2mm 3mm; }
        .cred img { width:34mm; height:34mm; }
        .cred .datos { flex:1; min-width:0; }
        .cred .nom { font-size:10.5pt; font-weight:700; line-height:1.15; }
        .cred .rut { font-size:9pt; margin-top:1mm; }
        .cred .linea { border-bottom:0.3mm solid #999; height:6mm; margin-bottom:1.5mm; }
        .cred .cod { font-family: ui-monospace, monospace; font-size:7pt; color:#333; margin-top:2mm; word-break:break-all; }
        .credv { display:flex; flex-direction:column; align-items:center; font-family: system-ui, Arial, sans-serif; padding:0 4mm; box-sizing:border-box; border-radius:3.2mm; }
        .credv .ojal { width:13mm; height:2.6mm; border:0.3mm solid #bbb; border-radius:1.3mm; margin-top:3mm; flex:none; }
        .credv .marca { display:flex; align-items:center; gap:2mm; margin-top:2.6mm; }
        .credv .marca img { width:10mm; height:10mm; }
        .credv .qs { font-size:17pt; font-weight:900; color:#b3192f; line-height:.95; } .credv .qs span { color:#1f4a27; }
        .credv .sub { font-size:5.6pt; color:#4a6b3a; letter-spacing:.3pt; }
        .credv .nombre { width:42mm; border-bottom:0.3mm solid #333; height:6mm; margin-bottom:2.2mm; font-size:7.5pt; font-weight:700; text-align:center; display:flex; align-items:flex-end; justify-content:center; line-height:1.05; overflow:hidden; }
        .credv .centro { display:flex; align-items:center; gap:1.2mm; margin-left:-4mm; }
        .credv .vert { writing-mode:vertical-rl; transform:rotate(180deg); font-size:7pt; letter-spacing:.6pt; color:#222; }
        .credv .qr { width:31mm; height:31mm; image-rendering: pixelated; }
        .credv .num { font-family: ui-monospace, Menlo, Consolas, monospace; font-size:8.4pt; margin-top:1.4mm; white-space:nowrap; }
        .credv .slo { text-align:center; margin-top:2mm; line-height:1; }
        .credv .s1 { font-size:13pt; font-weight:900; color:#2f7d32; }
        .credv .s2 { font-size:10pt; font-weight:700; color:#b3192f; margin-top:.5mm; }
        .credv .emp { position:absolute; bottom:2.6mm; left:6mm; right:6mm; border-top:0.2mm solid #ccc; padding-top:1mm; text-align:center; font-size:6.5pt; font-weight:700; color:#1f4a27; letter-spacing:.4pt; height:6mm; display:flex; align-items:center; justify-content:center; }
        .credv .emp img { max-height:6mm; max-width:36mm; object-fit:contain; }
        @media print { .credv * { -webkit-print-color-adjust:exact; print-color-adjust:exact; } }
        .soloqr { display:flex; flex-direction:column; align-items:center; justify-content:center; height:100%; padding:1mm 0 0.8mm; font-family: ui-monospace, Menlo, Consolas, monospace; }
        .soloqr img { height:${f.h - 7.5}mm; width:${f.h - 7.5}mm; image-rendering: pixelated; }
        .soloqr .cod { font-size:8pt; font-weight:700; letter-spacing:0.2pt; margin-top:0.8mm; color:#000; white-space:nowrap; }
        .eti { display:flex; align-items:center; gap:2mm; padding:1.5mm 2mm; font-family:system-ui,sans-serif; }
        .eti img { height:${f.h - 4}mm; width:${f.h - 4}mm; }
        .eti .cod { font-family: ui-monospace, monospace; font-size:7pt; word-break:break-all; }
        .eti .emp { font-size:6.5pt; color:#555; margin-top:1mm; }
        .tarja { display:flex; flex-direction:column; font-family: system-ui, sans-serif; border: 0.6mm solid #1f4a27; box-sizing:border-box; }
        .tarja .banda { background:#1f4a27; color:#fff; font-weight:800; padding:${f.h > 100 ? 3 : 1.6}mm 3mm; display:flex; justify-content:space-between; align-items:center; font-size:${f.h > 100 ? 14 : 8}pt; }
        .tarja .cuerpo { flex:1; display:flex; gap:3mm; padding:2.5mm 3mm; min-height:0; }
        .tarja img { height:100%; aspect-ratio:1; max-width:48%; image-rendering: pixelated; }
        .tarja .der { flex:1; display:flex; flex-direction:column; min-width:0; }
        .tarja .lbl { font-size:${f.h > 100 ? 12 : 7}pt; color:#555; text-transform:uppercase; letter-spacing:.5pt; }
        .tarja .num { font-size:${f.h > 100 ? 72 : 30}pt; font-weight:900; line-height:1; color:#000; }
        .tarja .linea { display:flex; gap:2mm; align-items:flex-end; font-size:${f.h > 100 ? 12 : 7}pt; color:#555; margin-top:${f.h > 100 ? 5 : 1.6}mm; }
        .tarja .linea span:last-child { flex:1; border-bottom:0.3mm solid #999; height:${f.h > 100 ? 7 : 3.5}mm; }
        .tarja .pie { font-family: ui-monospace, monospace; font-size:${f.h > 100 ? 11 : 7}pt; text-align:center; padding:0 0 1.2mm; font-weight:700; }
        .tarjat { display:flex; align-items:center; gap:2mm; height:100%; padding:1.5mm; font-family: system-ui, sans-serif; position:relative; }
        .tarjat img { height:27mm; width:27mm; image-rendering: pixelated; }
        .tarjat .lbl { font-size:8pt; font-weight:700; }
        .tarjat .num { font-size:24pt; font-weight:900; line-height:1; }
        .tarjat .emp { font-size:6pt; color:#333; margin-top:1mm; }
        .tarjat .cod { position:absolute; bottom:0.8mm; left:0; right:0; text-align:center; font-family: ui-monospace, monospace; font-size:7pt; font-weight:700; }
        @media print {
          body, html { background:#fff !important; }
          .hoja { margin:0; padding:0; box-shadow:none; page-break-after: always; break-after: page; width:auto; }
          .item { outline: ${esTermica ? 'none' : '0.2mm dashed #ccc'}; }
        }
      `}</style>

      <div className="no-print tarjeta" style={{ maxWidth: 820, margin: '0 auto', borderRadius: 0 }}>
        <div className="encabezado" style={{ marginBottom: '.5rem' }}>
          <h1 style={{ margin: 0 }}>Imprimir {items.length} {items[0]?.tipo === 'B' ? 'etiquetas de caja' : items[0]?.tipo === 'L' ? 'etiquetas de bin' : 'credenciales'}</h1>
          <div className="acciones">
            <button onClick={descargarPDF} disabled={!items.length || !!exportando}>⬇ PDF {esBin ? '58×40' : '58×30'}</button>
            <button onClick={descargarExcel} disabled={!items.length || !!exportando}>⬇ Excel</button>
            <button className="primario" onClick={() => window.print()} disabled={!items.length}>🖨 Imprimir</button>
          </div>
        </div>
        <div className="fila">
          <div className="campo">
            <label>Formato</label>
            <select value={formato} onChange={(e) => setFormato(e.target.value)}>
              {Object.entries(FORMATOS).filter(([, v]) => v.tipos.includes(tipoActual)).map(([k, v]) => <option key={k} value={k}>{v.t}</option>)}
            </select>
          </div>
          {items[0]?.tipo === 'W' && (formato === 'credencial' || formato === 'credencialv') && (
            <label className="check" style={{ flex: '0 1 auto' }}>
              <input type="checkbox" checked={conNombre} onChange={(e) => setConNombre(e.target.checked)} /> Imprimir nombre si está asignada
            </label>
          )}
        </div>
        {exportando && <div className="alerta info">{exportando}</div>}
        <details style={{ margin: '.4rem 0' }}>
          <summary><b>Impresora de etiquetas Bluetooth (SK58 / OpenLabel)</b></summary>
          <ol style={{ margin: '.4rem 0', paddingLeft: '1.2rem', lineHeight: 1.6 }}>
            <li>Toca <b>⬇ PDF 58×30</b>: se descarga un PDF con una etiqueta por página (QR + código).</li>
            <li>Abre <b>OpenLabel</b>, conecta la SK58 y elige imprimir <b>PDF</b> (o comparte el PDF a OpenLabel desde Descargas).</li>
            <li>Configura papel <b>58×30 mm</b> e imprime todas las páginas.</li>
          </ol>
          <div className="muted">Alternativa: <b>⬇ Excel</b> y en OpenLabel crea una etiqueta 58×30 con un elemento QR y un texto, ambos ligados a la columna <span className="mono">codigo</span>, e imprime en lote.</div>
        </details>
        <p className="muted" style={{ margin: 0 }}>
          En el diálogo de impresión usa escala 100% y sin márgenes del navegador. Para credenciales, imprime en cartulina y plastifica.
          {esTermica && ' En impresora térmica: en el diálogo de impresión elige el tamaño de papel igual a la etiqueta (por ejemplo 58×30 mm), márgenes "Ninguno" y escala 100%.'}
        </p>
      </div>

      {cargando && <p style={{ textAlign: 'center' }}>Generando códigos…</p>}

      {hojas.map((h, i) => (
        <div className="hoja" key={i}>
          {h.map((it) =>
            formato === 'tarjabin' || formato === 'tarjabingrande' ? (
              <div className="item tarja" key={it.codigo}>
                <div className="banda"><span>TARJA BIN</span><span>{empresa.toUpperCase()}</span></div>
                <div className="cuerpo">
                  <img src={it.qr} alt={it.codigo} />
                  <div className="der">
                    <div className="lbl">N° bin</div>
                    <div className="num">{numeroBin(it)}</div>
                    <div className="linea"><span>Fecha</span><span /></div>
                    <div className="linea"><span>Cuartel</span><span /></div>
                    <div className="linea"><span>Totes</span><span /></div>
                  </div>
                </div>
                <div className="pie">{it.codigo}</div>
              </div>
            ) : formato === 'termica5840bin' ? (
              <div className="item tarjat" key={it.codigo}>
                <img src={it.qr} alt={it.codigo} />
                <div>
                  <div className="lbl">BIN</div>
                  <div className="num">{numeroBin(it)}</div>
                  <div className="emp">{empresa}</div>
                </div>
                <div className="cod">{it.codigo}</div>
              </div>
            ) : formato === 'termica5830qr' ? (
              <div className="item soloqr" key={it.codigo}>
                <img src={it.qr} alt={it.codigo} />
                <div className="cod">{it.codigo}</div>
              </div>
            ) : formato === 'credencialv' ? (
              <div className="item credv" key={it.codigo}>
                <div className="ojal" />
                <div className="marca">
                  <img src="/logo.svg" alt="QSecha" />
                  <div><div className="qs">Q<span>Secha</span></div><div className="sub">Control de cosecha</div></div>
                </div>
                <div className="nombre">{conNombre && it.nombre ? it.nombre : ''}</div>
                <div className="centro"><div className="vert">ID TRABAJADOR</div><img className="qr" src={it.qr} alt={it.codigo} /></div>
                <div className="num">{it.codigo}</div>
                <div className="slo"><div className="s1">{ESLOGAN[0]}</div><div className="s2">{ESLOGAN[1]}</div></div>
                <div className="emp">{logoEmpresa ? <img src={logoEmpresa} alt={nombreEmpresa} /> : nombreEmpresa.toUpperCase()}</div>
              </div>
            ) : formato === 'credencial' ? (
              <div className="item cred" key={it.codigo}>
                <div className="banda"><span>{empresa.toUpperCase()}</span><span>CREDENCIAL COSECHA</span></div>
                <div className="cuerpo">
                  <img src={it.qr} alt={it.codigo} />
                  <div className="datos">
                    {conNombre && it.nombre ? (
                      <>
                        <div className="nom">{it.nombre}</div>
                        <div className="rut">RUT {formatearRut(it.rut || '')}</div>
                      </>
                    ) : (
                      <>
                        <div className="muted" style={{ fontSize: '7pt' }}>Nombre</div>
                        <div className="linea" />
                        <div className="muted" style={{ fontSize: '7pt' }}>RUT</div>
                        <div className="linea" />
                      </>
                    )}
                    <div className="cod">{it.codigo}</div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="item eti" key={it.codigo}>
                <img src={it.qr} alt={it.codigo} />
                <div>
                  <div className="cod">{it.codigo}</div>
                  {it.nombre && <div className="emp"><b>{it.nombre}</b></div>}
                  <div className="emp">{empresa}</div>
                </div>
              </div>
            )
          )}
        </div>
      ))}
    </div>
  );
}
