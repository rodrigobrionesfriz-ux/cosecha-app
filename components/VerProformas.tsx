'use client';
import { useEffect, useState } from 'react';
import { cargarTabla, useTabla } from '@/lib/datos';
import { nombreMes, numProforma, pdfProforma, Proforma } from '@/lib/proforma';
import { supabase } from '@/lib/supabase';
import { fechaCL, num } from '@/lib/util';

type Fila = {
  id: string; numero: number; contratista_id: string | null; contratista: string; mes: string; variedades: string | null;
  neto: number; iva: number; total: number; datos: Proforma; estado: 'emitida' | 'anulada'; motivo_anulacion: string | null; created_at: string;
};

/** Listado de proformas emitidas: reimprimir en PDF y anular (solo admin) */
export default function VerProformas({ esAdmin, onCerrar }: { esAdmin: boolean; onCerrar: () => void }) {
  const contratistas = useTabla<any>('contratistas', 'id,nombre', 'nombre');
  const [mes, setMes] = useState('');
  const [contratista, setContratista] = useState('');
  const [verAnuladas, setVerAnuladas] = useState(false);
  const [filas, setFilas] = useState<Fila[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState('');

  async function cargar() {
    setCargando(true);
    try {
      const l = await cargarTabla<Fila>('proformas', 'id,numero,contratista_id,contratista,mes,variedades,neto,iva,total,datos,estado,motivo_anulacion,created_at', (q) => {
        let r = q;
        if (mes) r = r.eq('mes', mes);
        if (contratista) r = r.eq('contratista_id', contratista);
        if (!verAnuladas) r = r.eq('estado', 'emitida');
        return r;
      });
      setFilas(l.sort((a, b) => b.numero - a.numero));
      setError('');
    } catch (e: any) { setError(e.message); }
    setCargando(false);
  }
  useEffect(() => { cargar(); }, [mes, contratista, verAnuladas]); // eslint-disable-line

  async function anular(f: Fila) {
    const motivo = prompt(`Anular proforma N° ${numProforma(f.numero)} de ${f.contratista} (${nombreMes(f.mes)}).\nIndica el motivo:`);
    if (!motivo?.trim()) return;
    const { error } = await supabase.rpc('anular_proforma', { p_id: f.id, p_motivo: motivo });
    if (error) { setError(error.message); return; }
    cargar();
  }

  const vigentes = filas.filter((f) => f.estado === 'emitida');
  const tot = vigentes.reduce((t, f) => ({ neto: t.neto + Number(f.neto), iva: t.iva + Number(f.iva), total: t.total + Number(f.total) }), { neto: 0, iva: 0, total: 0 });

  return (
    <div className="modal-fondo" onClick={onCerrar}>
      <div className="modal modal-ancho" onClick={(e) => e.stopPropagation()}>
        <div className="encabezado" style={{ marginBottom: '.6rem' }}>
          <h3 style={{ margin: 0 }}>Proformas emitidas</h3>
          <button onClick={onCerrar}>Cerrar</button>
        </div>
        <div className="fila">
          <div className="campo"><label>Mes</label><input type="month" value={mes} onChange={(e) => setMes(e.target.value)} /></div>
          <div className="campo">
            <label>Proveedor</label>
            <select value={contratista} onChange={(e) => setContratista(e.target.value)}>
              <option value="">Todos</option>
              {contratistas.filas.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select>
          </div>
          <div className="campo" style={{ flex: '0 0 auto' }}>
            <label style={{ display: 'flex', gap: '.4rem', alignItems: 'center', paddingBottom: '.55rem' }}>
              <input type="checkbox" checked={verAnuladas} onChange={(e) => setVerAnuladas(e.target.checked)} /> Mostrar anuladas
            </label>
          </div>
          {mes && <div className="campo" style={{ flex: '0 0 auto' }}><button onClick={() => setMes('')}>Todos los meses</button></div>}
        </div>
        {error && <div className="alerta error">{error}</div>}
        <div className="tabla-wrap" style={{ maxHeight: '60vh', overflowY: 'auto' }}>
          <table>
            <thead><tr><th>N°</th><th>Emitida</th><th>Proveedor</th><th>Mes</th><th>Variedades</th><th className="n">Neto</th><th className="n">IVA</th><th className="n">Total</th><th>Estado</th><th></th></tr></thead>
            <tbody>
              {cargando && <tr><td colSpan={10} className="muted">Cargando…</td></tr>}
              {!cargando && !filas.length && <tr><td colSpan={10} className="muted">No hay proformas con esos filtros.</td></tr>}
              {filas.map((f) => (
                <tr key={f.id} className={f.estado === 'anulada' ? 'fila-anulada' : ''}>
                  <td className="mono"><b>{numProforma(f.numero)}</b></td>
                  <td>{fechaCL(f.datos?.emitida || f.created_at.slice(0, 10))}</td>
                  <td>{f.contratista}</td>
                  <td>{nombreMes(f.mes)}</td>
                  <td>{f.variedades || 'Todas'}</td>
                  <td className="n">${num(f.neto)}</td>
                  <td className="n">${num(f.iva)}</td>
                  <td className="n"><b>${num(f.total)}</b></td>
                  <td>{f.estado === 'emitida' ? <span className="badge ok">Emitida</span> : <span className="badge av" title={f.motivo_anulacion || ''}>Anulada</span>}</td>
                  <td>
                    <span className="acciones" style={{ flexWrap: 'nowrap' }}>
                      <button className="chico" onClick={() => pdfProforma(f.datos, { anulada: f.estado === 'anulada' })}>⬇ PDF</button>
                      {esAdmin && f.estado === 'emitida' && <button className="chico peligro" onClick={() => anular(f)}>Anular</button>}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
            {vigentes.length > 1 && (
              <tfoot><tr><td colSpan={5}>Total vigentes ({vigentes.length})</td><td className="n">${num(tot.neto)}</td><td className="n">${num(tot.iva)}</td><td className="n">${num(tot.total)}</td><td colSpan={2}></td></tr></tfoot>
            )}
          </table>
        </div>
        <p className="muted" style={{ fontSize: '.82rem', marginBottom: 0 }}>Cada proforma se reimprime tal como se emitió. Las anuladas salen con la marca ANULADA.</p>
      </div>
    </div>
  );
}
