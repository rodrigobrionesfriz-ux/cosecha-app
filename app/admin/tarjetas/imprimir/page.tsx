'use client';
import { useEffect, useMemo, useState } from 'react';
import QRCode from 'qrcode';
import { cargarTabla } from '@/lib/datos';
import { useAuth } from '@/lib/auth';
import { formatearRut } from '@/lib/util';

type Item = { codigo: string; tipo: string; nombre?: string; rut?: string; qr?: string };

// Formatos de impresión
const FORMATOS: Record<string, { t: string; w: number; h: number; page: string; cols: number; rows: number; margen: number }> = {
  credencial: { t: 'Credencial 85×54 mm (10 por hoja A4)', w: 85.6, h: 54, page: 'A4', cols: 2, rows: 5, margen: 10 },
  etiqueta: { t: 'Etiqueta 50×30 mm (24 por hoja A4)', w: 50, h: 30, page: 'A4', cols: 4, rows: 8, margen: 6 },
  termica5830qr: { t: 'Térmica 58×30 mm · solo QR + código (para PVC)', w: 58, h: 30, page: '58mm 30mm', cols: 1, rows: 1, margen: 0 },
  termica5030: { t: 'Impresora térmica rollo 50×30 mm', w: 50, h: 30, page: '50mm 30mm', cols: 1, rows: 1, margen: 0 },
  termica4030: { t: 'Impresora térmica rollo 40×30 mm', w: 40, h: 30, page: '40mm 30mm', cols: 1, rows: 1, margen: 0 },
};

export default function Imprimir() {
  const { perfil } = useAuth();
  const [items, setItems] = useState<Item[]>([]);
  const [formato, setFormatoState] = useState('credencial');
  const setFormato = (v: string) => { setFormatoState(v); try { localStorage.setItem('cosecha-formato-imp', v); } catch {} };
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
          nombre: f.trabajador ? `${f.trabajador.nombres} ${f.trabajador.apellido_paterno || ''} ${f.trabajador.apellido_materno || ''}`.trim() : undefined,
          rut: f.trabajador?.rut,
          qr: await QRCode.toDataURL(f.codigo, { errorCorrectionLevel: 'M', margin: 0, width: 400 }),
        }))
      );
      setItems(lista);
      const guardado = (() => { try { return localStorage.getItem('cosecha-formato-imp'); } catch { return null; } })();
      if (guardado && FORMATOS[guardado]) setFormatoState(guardado);
      else if (lista[0]?.tipo === 'B' || lista[0]?.tipo === 'L') setFormatoState('etiqueta');
      setCargando(false);
    })();
  }, [perfil]);

  const [exportando, setExportando] = useState('');

  /** PDF con una página por etiqueta (58×30 mm): QR + código. Para abrir en la app de la impresora (OpenLabel). */
  async function descargarPDF() {
    setExportando('Generando PDF…');
    try {
      const { jsPDF } = await import('jspdf');
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
  const esTermica = formato.startsWith('termica');

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
        .soloqr { display:flex; flex-direction:column; align-items:center; justify-content:center; height:100%; padding:1mm 0 0.8mm; font-family: ui-monospace, Menlo, Consolas, monospace; }
        .soloqr img { height:${f.h - 7.5}mm; width:${f.h - 7.5}mm; image-rendering: pixelated; }
        .soloqr .cod { font-size:8pt; font-weight:700; letter-spacing:0.2pt; margin-top:0.8mm; color:#000; white-space:nowrap; }
        .eti { display:flex; align-items:center; gap:2mm; padding:1.5mm 2mm; font-family:system-ui,sans-serif; }
        .eti img { height:${f.h - 4}mm; width:${f.h - 4}mm; }
        .eti .cod { font-family: ui-monospace, monospace; font-size:7pt; word-break:break-all; }
        .eti .emp { font-size:6.5pt; color:#555; margin-top:1mm; }
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
            <button onClick={descargarPDF} disabled={!items.length || !!exportando}>⬇ PDF 58×30</button>
            <button onClick={descargarExcel} disabled={!items.length || !!exportando}>⬇ Excel</button>
            <button className="primario" onClick={() => window.print()} disabled={!items.length}>🖨 Imprimir</button>
          </div>
        </div>
        <div className="fila">
          <div className="campo">
            <label>Formato</label>
            <select value={formato} onChange={(e) => setFormato(e.target.value)}>
              {Object.entries(FORMATOS).map(([k, v]) => <option key={k} value={k}>{v.t}</option>)}
            </select>
          </div>
          {items[0]?.tipo === 'W' && formato === 'credencial' && (
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
            formato === 'termica5830qr' ? (
              <div className="item soloqr" key={it.codigo}>
                <img src={it.qr} alt={it.codigo} />
                <div className="cod">{it.codigo}</div>
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
