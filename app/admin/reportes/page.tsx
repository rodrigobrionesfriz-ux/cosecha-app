'use client';
import { useState } from 'react';
import EditarEntrega from '@/components/EditarEntrega';
import { useAuth } from '@/lib/auth';
import { useTabla } from '@/lib/datos';
import { agrupar, Agregado, cargarEntregas, Fila, totales } from '@/lib/reportes';
import { descargarCSV, fechaCL, formatearRut, hoyISO, horaCorta, num } from '@/lib/util';

const TABS = ['Por trabajador', 'Por día y trabajador', 'Por cuartel', 'Por contratista', 'Por día', 'Detalle'] as const;

export default function Reportes() {
  const { perfil } = useAuth();
  const huertos = useTabla<any>('huertos', 'id,nombre', 'orden');
  const hoy = hoyISO();
  const [desde, setDesde] = useState(hoy.slice(0, 8) + '01');
  const [hasta, setHasta] = useState(hoy);
  const [huerto, setHuerto] = useState('');
  const [filas, setFilas] = useState<Fila[] | null>(null);
  const [cargando, setCargando] = useState(false);
  const [tab, setTab] = useState<(typeof TABS)[number]>('Por trabajador');
  const [accion, setAccion] = useState<{ fila: Fila; modo: 'editar' | 'anular' | 'validar' } | null>(null);
  const [buscar, setBuscar] = useState('');

  async function consultar() {
    setCargando(true);
    try { setFilas(await cargarEntregas(desde, hasta, huerto || undefined)); } catch (e: any) { alert(e.message); }
    setCargando(false);
  }

  let datos: Agregado[] = [];
  let columnas: { k: keyof Agregado | string; t: string }[] = [];
  const v = filas || [];
  if (tab === 'Por trabajador') {
    datos = agrupar(v, (f) => f.trabajador_id, (f) => f.trabajador, (f) => `${f.rut}|${f.contratista || 'Directo'}`).sort((a, b) => a.etiqueta.localeCompare(b.etiqueta));
    columnas = [{ k: 'rut', t: 'RUT' }, { k: 'etiqueta', t: 'Trabajador' }, { k: 'contratista', t: 'Contratista' }];
  } else if (tab === 'Por día y trabajador') {
    datos = agrupar(v, (f) => f.fecha + f.trabajador_id, (f) => f.trabajador, (f) => `${f.rut}|${f.fecha}`).sort((a, b) => (a.extra! + a.etiqueta).localeCompare(b.extra! + b.etiqueta));
    columnas = [{ k: 'fecha', t: 'Fecha' }, { k: 'rut', t: 'RUT' }, { k: 'etiqueta', t: 'Trabajador' }];
  } else if (tab === 'Por cuartel') {
    datos = agrupar(v, (f) => f.huerto + f.cuartel + f.envase, (f) => f.cuartel, (f) => `${f.huerto}|${f.variedad || ''}|${f.envase}`).sort((a, b) => a.extra!.localeCompare(b.extra!));
    columnas = [{ k: 'huerto', t: 'Huerto' }, { k: 'etiqueta', t: 'Cuartel' }, { k: 'variedad', t: 'Variedad' }, { k: 'envase', t: 'Envase' }];
  } else if (tab === 'Por contratista') {
    datos = agrupar(v, (f) => f.contratista || 'Directo', (f) => f.contratista || 'Directo');
    columnas = [{ k: 'etiqueta', t: 'Contratista' }];
  } else if (tab === 'Por día') {
    datos = agrupar(v, (f) => f.fecha, (f) => f.fecha).sort((a, b) => a.clave.localeCompare(b.clave));
    columnas = [{ k: 'fecha', t: 'Fecha' }];
  }

  const val = (a: Agregado, k: string) => {
    const [x1, x2, x3] = (a.extra || '').split('|');
    if (tab === 'Por trabajador') return k === 'rut' ? formatearRut(x1) : k === 'contratista' ? x2 : (a as any)[k];
    if (tab === 'Por día y trabajador') return k === 'rut' ? formatearRut(x1) : k === 'fecha' ? fechaCL(x2) : (a as any)[k];
    if (tab === 'Por cuartel') return k === 'huerto' ? x1 : k === 'variedad' ? x2 : k === 'envase' ? x3 : (a as any)[k];
    if (tab === 'Por día') return fechaCL(a.etiqueta);
    return (a as any)[k];
  };

  function exportar() {
    if (tab === 'Detalle') {
      descargarCSV(`entregas_${desde}_${hasta}.csv`, detalle.map((f) => ({
        Fecha: fechaCL(f.fecha), Hora: horaCorta(f.leido_en), Huerto: f.huerto, Cuartel: f.cuartel, Variedad: f.variedad, RUT: f.rut,
        Trabajador: f.trabajador, Contratista: f.contratista || 'Directo', Envase: f.envase, Calidad: f.calidad, Cantidad: f.cantidad,
        Kilos: f.kilos_estimados, Monto: f.monto, Credencial: f.codigo_credencial, Caja: f.codigo_caja, Jefe: f.jefe,
        Estado: f.estado === 'A' ? 'Válida' : f.estado === 'D' ? 'Duplicada' : 'Anulada', Observación: f.observacion,
      })));
      return;
    }
    descargarCSV(`${tab.toLowerCase().replace(/ /g, '_')}_${desde}_${hasta}.csv`, datos.map((a) => {
      const o: any = {};
      columnas.forEach((c) => (o[c.t] = val(a, c.k as string)));
      o.Entregas = a.entregas; o.Envases = a.envases; o.Kilos = Math.round(a.kilos * 10) / 10; o['Monto $'] = Math.round(a.monto);
      return o;
    }));
  }

  const b = buscar.toLowerCase();
  const detalle = v.filter((f) => (!b || `${f.trabajador} ${f.rut} ${f.cuartel} ${f.codigo_caja ?? ''}`.toLowerCase().includes(b)));
  const t = totales(datos);
  const nDup = v.filter((f) => f.estado === 'D').length;

  return (
    <div>
      <h1>Reportes y pagos</h1>
      <div className="tarjeta fila">
        <div className="campo"><label>Desde</label><input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} /></div>
        <div className="campo"><label>Hasta</label><input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} /></div>
        <div className="campo">
          <label>Huerto</label>
          <select value={huerto} onChange={(e) => setHuerto(e.target.value)}>
            <option value="">Todos</option>
            {huertos.filas.map((h) => <option key={h.id} value={h.id}>{h.nombre}</option>)}
          </select>
        </div>
        <div className="campo" style={{ flex: '0 0 auto' }}><button className="primario" onClick={consultar} disabled={cargando}>{cargando ? 'Cargando…' : 'Consultar'}</button></div>
      </div>

      {filas && (
        <>
          <div className="tabs">
            {TABS.map((x) => <button key={x} className={tab === x ? 'activo' : ''} onClick={() => setTab(x)}>{x}{x === 'Detalle' && nDup ? ` (${nDup} dup.)` : ''}</button>)}
          </div>
          <div className="encabezado">
            <span className="muted">{v.filter((f) => f.estado === 'A').length} entregas válidas</span>
            <div className="acciones">
              {tab === 'Detalle' && (
                <>
                  <input placeholder="Filtrar…" value={buscar} onChange={(e) => setBuscar(e.target.value)} style={{ width: 200 }} />
                </>
              )}
              <button onClick={exportar}>⬇ Exportar a Excel (CSV)</button>
            </div>
          </div>

          {tab !== 'Detalle' ? (
            <div className="tabla-wrap">
              <table>
                <thead><tr>{columnas.map((c) => <th key={c.t}>{c.t}</th>)}<th className="n">Entregas</th><th className="n">Envases</th><th className="n">Kilos est.</th>{tab !== 'Por trabajador' && tab !== 'Por día y trabajador' && <th className="n">Trab.</th>}<th className="n">Monto $</th></tr></thead>
                <tbody>
                  {!datos.length && <tr><td colSpan={10} className="muted">Sin datos en el período.</td></tr>}
                  {datos.map((a) => (
                    <tr key={a.clave}>
                      {columnas.map((c) => <td key={c.t}>{val(a, c.k as string)}</td>)}
                      <td className="n">{num(a.entregas)}</td><td className="n">{num(a.envases, a.envases % 1 ? 1 : 0)}</td><td className="n">{num(a.kilos)}</td>
                      {tab !== 'Por trabajador' && tab !== 'Por día y trabajador' && <td className="n">{a.trabajadores}</td>}
                      <td className="n">{num(a.monto)}</td>
                    </tr>
                  ))}
                </tbody>
                {datos.length > 0 && (
                  <tfoot><tr><td colSpan={columnas.length}>Total</td><td className="n">{num(t.entregas)}</td><td className="n">{num(t.envases)}</td><td className="n">{num(t.kilos)}</td>{tab !== 'Por trabajador' && tab !== 'Por día y trabajador' && <td></td>}<td className="n">{num(t.monto)}</td></tr></tfoot>
                )}
              </table>
            </div>
          ) : (
            <div className="tabla-wrap" style={{ maxHeight: '65vh', overflowY: 'auto' }}>
              <table>
                <thead><tr><th>Fecha</th><th>Hora</th><th>Trabajador</th><th>Cuartel</th><th>Envase</th><th>Calidad</th><th className="n">Cant.</th><th>Caja</th><th>Jefe</th><th>Estado</th>{perfil?.rol === 'admin' && <th></th>}</tr></thead>
                <tbody>
                  {detalle.slice(-2000).reverse().map((f) => (
                    <tr key={f.id}>
                      <td>{fechaCL(f.fecha)}</td><td>{horaCorta(f.leido_en)}</td><td>{f.trabajador}</td><td>{f.cuartel}</td><td>{f.envase}</td>
                      <td>{f.calidad || '—'}</td><td className="n">{num(f.cantidad, f.cantidad % 1 ? 1 : 0)}</td><td className="mono muted">{f.codigo_caja || ''}</td><td>{f.jefe}</td>
                      <td>
                        {f.estado === 'A' && <span className="badge ok">Válida</span>}
                        {f.estado === 'D' && <span className="badge av" title={f.observacion || ''}>Duplicada</span>}
                        {f.editada && <> <span className="badge" title="Editado por administración; ver historial en Anulados y cambios">Editada</span></>}
                      </td>
                      {perfil?.rol === 'admin' && (
                        <td>
                          <span className="acciones" style={{ flexWrap: 'nowrap' }}>
                            {f.estado === 'D' && <button className="chico" onClick={() => setAccion({ fila: f, modo: 'validar' })}>Validar</button>}
                            <button className="chico" onClick={() => setAccion({ fila: f, modo: 'editar' })}>Editar</button>
                            <button className="chico peligro" onClick={() => setAccion({ fila: f, modo: 'anular' })}>Anular</button>
                          </span>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
      {accion && (
        <EditarEntrega fila={accion.fila} modo={accion.modo} onCerrar={() => setAccion(null)}
          onListo={() => { setAccion(null); consultar(); }} />
      )}
      <p className="muted" style={{ marginTop: '1rem' }}>Los registros anulados no aparecen aquí ni suman en pagos. Revísalos en <a href="/admin/anulados/">Anulados y cambios</a>.</p>
    </div>
  );
}
