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
  termica5030: { t: 'Impresora térmica rollo 50×30 mm', w: 50, h: 30, page: '50mm 30mm', cols: 1, rows: 1, margen: 0 },
  termica4030: { t: 'Impresora térmica rollo 40×30 mm', w: 40, h: 30, page: '40mm 30mm', cols: 1, rows: 1, margen: 0 },
};

export default function Imprimir() {
  const { perfil } = useAuth();
  const [items, setItems] = useState<Item[]>([]);
  const [formato, setFormato] = useState('credencial');
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
          qr: await QRCode.toDataURL(f.codigo, { errorCorrectionLevel: 'M', margin: 0, width: 300 }),
        }))
      );
      setItems(lista);
      if (lista[0]?.tipo === 'B') setFormato('etiqueta');
      setCargando(false);
    })();
  }, [perfil]);

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
          <h1 style={{ margin: 0 }}>Imprimir {items.length} {items[0]?.tipo === 'B' ? 'etiquetas' : 'credenciales'}</h1>
          <button className="primario" onClick={() => window.print()} disabled={!items.length}>🖨 Imprimir</button>
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
        <p className="muted" style={{ margin: 0 }}>
          En el diálogo de impresión usa escala 100% y sin márgenes del navegador. Para credenciales, imprime en cartulina y plastifica.
          {esTermica && ' En impresora térmica, elige el tamaño de papel de la etiqueta.'}
        </p>
      </div>

      {cargando && <p style={{ textAlign: 'center' }}>Generando códigos…</p>}

      {hojas.map((h, i) => (
        <div className="hoja" key={i}>
          {h.map((it) =>
            formato === 'credencial' ? (
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
