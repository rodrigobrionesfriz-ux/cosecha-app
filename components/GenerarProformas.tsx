'use client';
import { useState } from 'react';
import { cargarTabla, useTabla } from '@/lib/datos';
import { armarProformas, nombreMes, pdfProforma, rangoMes } from '@/lib/proforma';
import { cargarEntregas } from '@/lib/reportes';
import { hoyISO } from '@/lib/util';

/** Ventana para generar una proforma PDF por contratista: mes, proveedor y una o más variedades */
export default function GenerarProformas({ empresa, empresaRut, onCerrar }: { empresa: string; empresaRut: string; onCerrar: () => void }) {
  const contratistas = useTabla<any>('contratistas', 'id,nombre,rut,activo', 'nombre');
  const variedades = useTabla<any>('variedades', 'id,nombre', 'nombre');
  const [mes, setMes] = useState(hoyISO().slice(0, 7));
  const [proveedor, setProveedor] = useState('');
  const [selVar, setSelVar] = useState<string[]>([]); // vacío = todas
  const [generando, setGenerando] = useState(false);
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'error' | 'aviso'; t: string } | null>(null);

  const todas = selVar.length === 0;
  const alternar = (id: string) => setSelVar(selVar.includes(id) ? selVar.filter((x) => x !== id) : [...selVar, id]);

  async function generar(e: React.FormEvent) {
    e.preventDefault();
    setGenerando(true); setMsg(null);
    try {
      const { desde, hasta } = rangoMes(mes);
      const [filas, kp] = await Promise.all([
        cargarEntregas(desde, hasta),
        cargarTabla<any>('kilos_packing', 'fecha,huerto_id,kilos', (q) => q.gte('fecha', desde).lte('fecha', hasta)),
      ]);
      const packing: Record<string, number> = {};
      for (const x of kp) packing[`${x.fecha}|${x.huerto_id}`] = Number(x.kilos);
      const variedadesTxt = todas ? 'Todas' : variedades.filas.filter((v) => selVar.includes(v.id)).map((v) => v.nombre).join(', ');
      const proformas = armarProformas(filas, {
        empresa, empresaRut, mes, contratistaId: proveedor, variedadIds: todas ? null : selVar, variedadesTxt, packing,
        rutContratista: Object.fromEntries(contratistas.filas.map((c) => [c.id, c.rut || ''])),
      });
      if (!proformas.length) {
        setMsg({ tipo: 'aviso', t: `No hay entregas de contratistas en ${nombreMes(mes)} con esos filtros.` });
      } else {
        for (const p of proformas) {
          await pdfProforma(p);
          await new Promise((r) => setTimeout(r, 400)); // el navegador descarga uno tras otro
        }
        setMsg({ tipo: 'ok', t: proformas.length === 1 ? `Proforma de ${proformas[0].contratista} generada.` : `${proformas.length} proformas generadas (un PDF por contratista). Si el navegador pregunta, permite las descargas múltiples.` });
      }
    } catch (err: any) { setMsg({ tipo: 'error', t: err.message }); }
    setGenerando(false);
  }

  return (
    <div className="modal-fondo" onClick={onCerrar}>
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={generar}>
        <h3 style={{ marginTop: 0 }}>Generar proformas</h3>
        <p className="muted" style={{ marginTop: 0, fontSize: '.88rem' }}>Una proforma en PDF por contratista con lo cosechado en el mes. Los valores son netos y al final se agrega el IVA (19%).</p>
        <div className="fila">
          <div className="campo"><label>Mes</label><input type="month" value={mes} onChange={(e) => setMes(e.target.value)} required /></div>
          <div className="campo">
            <label>Proveedor</label>
            <select value={proveedor} onChange={(e) => setProveedor(e.target.value)}>
              <option value="">Todos los contratistas</option>
              {contratistas.filas.map((c) => <option key={c.id} value={c.id}>{c.nombre}{c.activo === false ? ' (inactivo)' : ''}</option>)}
            </select>
          </div>
        </div>
        <div className="campo">
          <label>Variedad <span className="muted" style={{ fontWeight: 400 }}>(puedes elegir más de una)</span></label>
          <div className="chips-sel">
            <button type="button" className={todas ? 'activo' : ''} onClick={() => setSelVar([])}>Todas</button>
            {variedades.filas.map((v) => (
              <button type="button" key={v.id} className={selVar.includes(v.id) ? 'activo' : ''} onClick={() => alternar(v.id)}>
                {selVar.includes(v.id) ? '✓ ' : ''}{v.nombre}
              </button>
            ))}
          </div>
        </div>
        {msg && <div className={`alerta ${msg.tipo}`}>{msg.t}</div>}
        <div className="acciones" style={{ justifyContent: 'flex-end' }}>
          <button type="button" onClick={onCerrar}>Cerrar</button>
          <button className="primario" type="submit" disabled={generando}>{generando ? 'Generando…' : 'Generar proformas'}</button>
        </div>
      </form>
    </div>
  );
}
