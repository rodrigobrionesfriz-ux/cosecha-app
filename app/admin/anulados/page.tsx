'use client';
import { useState } from 'react';
import { useAuth } from '@/lib/auth';
import { cargarTabla, useTabla } from '@/lib/datos';
import { cargarEntregas, Fila } from '@/lib/reportes';
import { descargarCSV, fechaCL, hoyISO, horaCorta, num } from '@/lib/util';
import EditarEntrega from '@/components/EditarEntrega';

const ACCIONES: Record<string, [string, string]> = {
  editar: ['Edición', 'av'], anular: ['Anulación', 'err'], restaurar: ['Restauración', 'ok'], validar: ['Validación', 'ok'],
};

// Campos que se comparan para mostrar qué cambió en una edición
const CAMPOS: Record<string, string> = {
  cantidad: 'Cantidad', cuartel_id: 'Cuartel', trabajador_id: 'Trabajador', envase_id: 'Envase',
  calidad_id: 'Calidad', turno_id: 'Jornada', contratista_id: 'Contratista', fecha: 'Fecha',
};

export default function Anulados() {
  const { perfil } = useAuth();
  const esAdmin = perfil?.rol === 'admin';
  const huertos = useTabla<any>('huertos', 'id,nombre', 'orden');
  const hoy = hoyISO();
  const [desde, setDesde] = useState(hoy.slice(0, 8) + '01');
  const [hasta, setHasta] = useState(hoy);
  const [huerto, setHuerto] = useState('');
  const [tab, setTab] = useState<'anulados' | 'historial'>('anulados');
  const [anulados, setAnulados] = useState<Fila[] | null>(null);
  const [historial, setHistorial] = useState<any[] | null>(null);
  const [nombres, setNombres] = useState<Record<string, string>>({});
  const [cargando, setCargando] = useState(false);
  const [restaurar, setRestaurar] = useState<Fila | null>(null);

  async function consultar() {
    setCargando(true);
    try {
      const [a, h] = await Promise.all([
        cargarEntregas(desde, hasta, huerto || undefined, 'anuladas'),
        cargarTabla<any>('auditoria_entregas', '*', (q) => q.gte('creado_en', `${desde}T00:00:00-04:00`).lte('creado_en', `${hasta}T23:59:59-03:00`), 'creado_en'),
      ]);
      setAnulados(a.sort((x, y) => (y.anulada_en || '').localeCompare(x.anulada_en || '')));
      setHistorial(h.reverse());
      // nombres legibles para el detalle de cambios
      if (!Object.keys(nombres).length) {
        const [c, t, e, ca, tu, co] = await Promise.all([
          cargarTabla<any>('cuarteles', 'id,nombre'), cargarTabla<any>('trabajadores', 'id,nombres,apellido_paterno'),
          cargarTabla<any>('envases', 'id,nombre'), cargarTabla<any>('calidades', 'id,nombre'),
          cargarTabla<any>('turnos', 'id,nombre'), cargarTabla<any>('contratistas', 'id,nombre'),
        ]);
        const n: Record<string, string> = {};
        [...c, ...e, ...ca, ...tu, ...co].forEach((x) => (n[x.id] = x.nombre));
        t.forEach((x) => (n[x.id] = `${x.nombres} ${x.apellido_paterno ?? ''}`.trim()));
        setNombres(n);
      }
    } catch (e: any) { alert(e.message); }
    setCargando(false);
  }

  const legible = (k: string, v: any) => {
    if (v === null || v === undefined || v === '') return '—';
    if (k === 'fecha') return fechaCL(v);
    if (k.endsWith('_id')) return nombres[v] || '?';
    return String(v);
  };
  const diferencias = (a: any) => {
    if (a.accion !== 'editar' || !a.antes || !a.despues) return null;
    return Object.keys(CAMPOS).filter((k) => String(a.antes[k] ?? '') !== String(a.despues[k] ?? ''))
      .map((k) => `${CAMPOS[k]}: ${legible(k, a.antes[k])} → ${legible(k, a.despues[k])}`);
  };
  const trabDe = (a: any) => legible('trabajador_id', a.despues?.trabajador_id || a.antes?.trabajador_id);

  function exportar() {
    if (tab === 'anulados' && anulados) {
      descargarCSV(`anulados_${desde}_${hasta}.csv`, anulados.map((f) => ({
        'Fecha entrega': fechaCL(f.fecha), Hora: horaCorta(f.leido_en), Trabajador: f.trabajador, RUT: f.rut, Huerto: f.huerto,
        Cuartel: f.cuartel, Envase: f.envase, Cantidad: f.cantidad, 'Anulado el': f.anulada_en ? `${fechaCL(f.anulada_en)} ${horaCorta(f.anulada_en)}` : '',
        'Anulado por': f.anulada_por_nombre, Motivo: f.motivo_anulacion, 'Registrado por': f.jefe,
      })));
    } else if (historial) {
      descargarCSV(`historial_cambios_${desde}_${hasta}.csv`, historial.map((a) => ({
        Fecha: `${fechaCL(a.creado_en)} ${horaCorta(a.creado_en)}`, Acción: ACCIONES[a.accion]?.[0] ?? a.accion,
        Trabajador: trabDe(a), Usuario: a.usuario_nombre, Motivo: a.motivo, Cambios: (diferencias(a) || []).join(' | '),
      })));
    }
  }

  return (
    <div>
      <h1>Anulados y cambios</h1>
      <p className="muted" style={{ marginTop: -8 }}>
        Los registros anulados se conservan, pero no aparecen en reportes ni suman en pagos. Aquí puedes revisarlos, restaurarlos y ver el historial de ediciones con su motivo.
      </p>
      <div className="tarjeta fila">
        <div className="campo"><label>Desde</label><input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} /></div>
        <div className="campo"><label>Hasta</label><input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} /></div>
        <div className="campo">
          <label>Huerto (anulados)</label>
          <select value={huerto} onChange={(e) => setHuerto(e.target.value)}>
            <option value="">Todos</option>
            {huertos.filas.map((h) => <option key={h.id} value={h.id}>{h.nombre}</option>)}
          </select>
        </div>
        <div className="campo" style={{ flex: '0 0 auto' }}><button className="primario" onClick={consultar} disabled={cargando}>{cargando ? 'Cargando…' : 'Consultar'}</button></div>
      </div>

      {anulados && historial && (
        <>
          <div className="tabs">
            <button className={tab === 'anulados' ? 'activo' : ''} onClick={() => setTab('anulados')}>Registros anulados ({anulados.length})</button>
            <button className={tab === 'historial' ? 'activo' : ''} onClick={() => setTab('historial')}>Historial de cambios ({historial.length})</button>
          </div>
          <div className="encabezado"><span className="muted">{tab === 'anulados' ? 'Por fecha de la entrega' : 'Por fecha del cambio'}</span><button onClick={exportar}>⬇ Exportar a Excel (CSV)</button></div>

          {tab === 'anulados' ? (
            <div className="tabla-wrap">
              <table>
                <thead><tr><th>Entrega</th><th>Trabajador</th><th>Cuartel</th><th className="n">Cant.</th><th>Motivo</th><th>Anulado por</th>{esAdmin && <th></th>}</tr></thead>
                <tbody>
                  {!anulados.length && <tr><td colSpan={7} className="muted">No hay registros anulados en el período.</td></tr>}
                  {anulados.map((f) => (
                    <tr key={f.id}>
                      <td>{fechaCL(f.fecha)} {horaCorta(f.leido_en)}</td>
                      <td>{f.trabajador}</td>
                      <td>{f.cuartel}</td>
                      <td className="n">{num(f.cantidad, f.cantidad % 1 ? 1 : 0)} <span className="muted">{f.envase}</span></td>
                      <td>{f.motivo_anulacion}</td>
                      <td>{f.anulada_por_nombre}<br /><span className="muted">{f.anulada_en ? `${fechaCL(f.anulada_en)} ${horaCorta(f.anulada_en)}` : ''}</span></td>
                      {esAdmin && <td><button className="chico" onClick={() => setRestaurar(f)}>Restaurar</button></td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="tabla-wrap">
              <table>
                <thead><tr><th>Cuándo</th><th>Acción</th><th>Trabajador</th><th>Motivo</th><th>Qué cambió</th><th>Usuario</th></tr></thead>
                <tbody>
                  {!historial.length && <tr><td colSpan={6} className="muted">Sin cambios en el período.</td></tr>}
                  {historial.map((a) => {
                    const d = diferencias(a);
                    return (
                      <tr key={a.id}>
                        <td>{fechaCL(a.creado_en)} {horaCorta(a.creado_en)}</td>
                        <td><span className={`badge ${ACCIONES[a.accion]?.[1] ?? ''}`}>{ACCIONES[a.accion]?.[0] ?? a.accion}</span></td>
                        <td>{trabDe(a)}</td>
                        <td>{a.motivo}</td>
                        <td style={{ fontSize: '.85rem' }}>{d ? d.map((x, i) => <div key={i}>{x}</div>) : <span className="muted">—</span>}</td>
                        <td>{a.usuario_nombre}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {restaurar && (
        <EditarEntrega fila={restaurar} modo="restaurar" onCerrar={() => setRestaurar(null)}
          onListo={() => { setRestaurar(null); consultar(); }} />
      )}
    </div>
  );
}
