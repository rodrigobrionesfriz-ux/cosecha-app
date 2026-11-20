'use client';
import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { cargarTabla, useTabla } from '@/lib/datos';
import { ESTADOS_BIN, TEXTO_EVENTO } from '@/lib/bins';
import { descargarCSV, fechaCL, horaCorta, hoyISO, num, uuid } from '@/lib/util';
import Crud from '@/components/Crud';

type Tab = 'Bins' | 'Despachos' | 'Rechazos' | 'Cámaras y calidad';
const TABS: Tab[] = ['Bins', 'Despachos', 'Rechazos', 'Cámaras y calidad'];
const ORIGEN: Record<string, string> = { campo: 'Campo', acopio: 'Armado en acopio', recepcion: 'Sin registro de campo' };

const fh = (iso?: string | null) => (iso ? `${fechaCL(iso)} ${horaCorta(iso)}` : '');

export default function AcopioAdmin() {
  const { perfil } = useAuth();
  const [tab, setTab] = useState<Tab>('Bins');
  const [desde, setDesde] = useState(hoyISO());
  const [hasta, setHasta] = useState(hoyISO());
  const [estado, setEstado] = useState('');
  const [huertoId, setHuertoId] = useState('');
  const [bins, setBins] = useState<any[]>([]);
  const [despachos, setDespachos] = useState<any[]>([]);
  const [rechazos, setRechazos] = useState<any[]>([]);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState('');
  const [sel, setSel] = useState<any | null>(null);
  const huertos = useTabla<any>('huertos', 'id,nombre', 'nombre');
  const especies = useTabla<any>('especies', 'id,nombre', 'nombre');
  const params = useTabla<any>('parametros_calidad', 'id,nombre,unidad', 'orden');

  async function cargar() {
    setCargando(true); setError('');
    try {
      if (tab === 'Bins') {
        setBins(await cargarTabla('v_bins', '*', (q) => {
          let r = q.gte('fecha', desde).lte('fecha', hasta);
          if (estado === 'pendientes') r = r.in('estado', ['abierto', 'cerrado']);
          else if (estado) r = r.eq('estado', estado);
          if (huertoId) r = r.eq('huerto_id', huertoId);
          return r;
        }, 'codigo'));
      }
      if (tab === 'Despachos') {
        const d = await cargarTabla<any>('despachos', '*', (q) => q.gte('abierto_en', desde + 'T00:00:00-03:00').lte('abierto_en', hasta + 'T23:59:59-03:00'), 'abierto_en');
        const ids = d.map((x) => x.id);
        const b = ids.length ? await cargarTabla<any>('v_bins', 'id,codigo,despacho_id,envases,kilos,huerto,cuartel,variedad', (q) => q.in('despacho_id', ids)) : [];
        setDespachos(d.reverse().map((x) => ({ ...x, bins: b.filter((y) => y.despacho_id === x.id) })));
      }
      if (tab === 'Rechazos') {
        setRechazos(await cargarTabla('eventos_bin', '*, perfil:perfiles!eventos_bin_hecho_por_fkey(nombre)', (q) =>
          q.neq('resultado', 'OK').gte('hecho_en', desde + 'T00:00:00-03:00').lte('hecho_en', hasta + 'T23:59:59-03:00'), 'hecho_en'));
      }
    } catch (e: any) { setError(e.message); }
    setCargando(false);
  }
  useEffect(() => { if (tab !== 'Cámaras y calidad') cargar(); }, [tab, desde, hasta, estado, huertoId]); // eslint-disable-line

  const tot = useMemo(() => {
    const c = (f: (b: any) => boolean) => bins.filter(f).length;
    return {
      total: bins.length,
      pendientes: c((b) => b.estado === 'abierto' || b.estado === 'cerrado'),
      recibidos: c((b) => !!b.recibido_en),
      camara: c((b) => b.estado === 'en_camara'),
      despachados: c((b) => b.estado === 'despachado'),
      kilos: bins.reduce((s, b) => s + Number(b.kilos || 0), 0),
    };
  }, [bins]);

  function exportar() {
    descargarCSV(`bins_${desde}_${hasta}.csv`, bins.map((b) => {
      const o: any = {
        Bin: b.codigo, Estado: ESTADOS_BIN[b.estado], Origen: ORIGEN[b.origen], Huerto: b.huerto, Cuartel: b.cuartel, Variedad: b.variedad,
        Cuadrilla: b.cuadrilla || b.abierto_por_nombre, Envases: b.envases, Kilos: Math.round(b.kilos), Trabajadores: b.trabajadores,
        Abierto: fh(b.abierto_en), Cerrado: fh(b.cerrado_en), Recibido: fh(b.recibido_en), 'Recibido por': b.recibido_por_nombre,
        'Min. campo a acopio': b.minutos_a_acopio, Cámara: b.camara, 'Min. en cámara': b.minutos_camara,
        Despacho: b.despacho_numero, Patente: b.patente, Guía: b.guia, Observación: b.observacion,
      };
      for (const p of params.filas) o[p.nombre] = b.calidad?.[p.id] ?? '';
      return o;
    }));
  }

  return (
    <div>
      <div className="encabezado"><h1>Acopio y bins</h1></div>
      <div className="tabs">
        {TABS.map((t) => <button key={t} className={tab === t ? 'activo' : ''} onClick={() => { setTab(t); setSel(null); }}>{t}</button>)}
      </div>

      {tab !== 'Cámaras y calidad' && (
        <div className="fila filtros" style={{ marginBottom: '1rem' }}>
          <div className="campo"><label>Desde</label><input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} /></div>
          <div className="campo"><label>Hasta</label><input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} /></div>
          {tab === 'Bins' && (
            <>
              <div className="campo">
                <label>Estado</label>
                <select value={estado} onChange={(e) => setEstado(e.target.value)}>
                  <option value="">Todos</option>
                  <option value="pendientes">Pendientes de recepción</option>
                  {Object.entries(ESTADOS_BIN).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
              <div className="campo">
                <label>Huerto</label>
                <select value={huertoId} onChange={(e) => setHuertoId(e.target.value)}>
                  <option value="">Todos</option>
                  {huertos.filas.map((h) => <option key={h.id} value={h.id}>{h.nombre}</option>)}
                </select>
              </div>
            </>
          )}
          <div className="campo" style={{ flex: '0 0 auto' }}><label>&nbsp;</label><button onClick={cargar}>Actualizar</button></div>
        </div>
      )}
      {error && <div className="alerta error">{error}</div>}
      {cargando && <p className="muted">Cargando…</p>}

      {tab === 'Bins' && (
        <>
          <div className="kpis">
            <div className="kpi"><div className="v">{tot.total}</div><div className="l">Bins</div></div>
            <div className="kpi"><div className="v">{tot.pendientes}</div><div className="l">Pendientes de recepción</div></div>
            <div className="kpi"><div className="v">{tot.recibidos}</div><div className="l">Recibidos</div></div>
            <div className="kpi"><div className="v">{tot.camara}</div><div className="l">En cámara</div></div>
            <div className="kpi"><div className="v">{tot.despachados}</div><div className="l">Despachados</div></div>
            <div className="kpi"><div className="v">{num(tot.kilos)}</div><div className="l">Kilos estimados</div></div>
          </div>
          <div className="acciones" style={{ marginBottom: '.6rem' }}>
            <button onClick={exportar} disabled={!bins.length}>⬇ Exportar a Excel (CSV)</button>
            <a className="btn" href="/admin/tarjetas/">Imprimir etiquetas de bin</a>
          </div>
          {sel && <DetalleBin b={sel} params={params.filas} esAdmin={perfil?.rol === 'admin'} cerrar={() => setSel(null)} recargar={cargar} />}
          <div className="tabla-wrap">
            <table>
              <thead><tr><th>Bin</th><th>Estado</th><th>Origen</th><th>Cuartel</th><th>Cuadrilla</th><th className="n">Envases</th><th className="n">Kilos</th><th>Abierto</th><th>Recibido</th><th className="n">Min. a acopio</th><th>Cámara</th><th>Despacho</th></tr></thead>
              <tbody>
                {!bins.length && !cargando && <tr><td colSpan={12} className="muted">Sin bins en el período.</td></tr>}
                {bins.map((b) => {
                  const alerta = b.estado === 'en_camara' && b.minutos_alerta > 0 && b.minutos_camara >= b.minutos_alerta;
                  return (
                    <tr key={b.id} onClick={() => setSel(b)} style={{ cursor: 'pointer' }} className={sel?.id === b.id ? 'sel' : ''}>
                      <td className="mono">{b.codigo.slice(-8)}</td>
                      <td><span className={`badge ${b.estado === 'despachado' || b.estado === 'enfriado' ? 'ok' : b.estado === 'anulado' ? 'err' : ''}`}>{ESTADOS_BIN[b.estado]}</span></td>
                      <td className="muted">{ORIGEN[b.origen]}</td>
                      <td>{b.cuartel ?? '—'}{b.variedad ? <span className="muted"> · {b.variedad}</span> : null}</td>
                      <td>{b.cuadrilla || b.abierto_por_nombre || '—'}</td>
                      <td className="n">{num(b.envases)}</td>
                      <td className="n">{num(b.kilos)}</td>
                      <td>{b.abierto_en ? horaCorta(b.abierto_en) : '—'}</td>
                      <td>{b.recibido_en ? horaCorta(b.recibido_en) : '—'}</td>
                      <td className="n">{b.minutos_a_acopio ?? '—'}</td>
                      <td>{b.camara ? `${alerta ? '⚠ ' : ''}${b.camara} · ${b.minutos_camara} min` : '—'}</td>
                      <td>{b.patente ? `${b.patente}${b.guia ? ' · guía ' + b.guia : ''}` : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {tab === 'Despachos' && (
        <div>
          {!despachos.length && !cargando && <p className="muted">Sin despachos en el período.</p>}
          {despachos.map((d) => (
            <details key={d.id} className="tarjeta">
              <summary>
                <b>N° {d.numero} · {d.patente}</b>
                <span className="muted"> · {fh(d.abierto_en)}{d.guia ? ` · guía ${d.guia}` : ''}{d.destino ? ` · ${d.destino}` : ''} · {d.bins.length} bins · {num(d.bins.reduce((s: number, b: any) => s + Number(b.kilos || 0), 0))} kg</span>
                {' '}<span className={`badge ${d.estado === 'cerrado' ? 'ok' : ''}`}>{d.estado}</span>
              </summary>
              {d.chofer && <p className="muted">Chofer: {d.chofer}</p>}
              <div className="tabla-wrap" style={{ marginTop: '.6rem' }}>
                <table>
                  <thead><tr><th>Bin</th><th>Huerto</th><th>Cuartel</th><th>Variedad</th><th className="n">Envases</th><th className="n">Kilos</th></tr></thead>
                  <tbody>{d.bins.map((b: any) => <tr key={b.id}><td className="mono">{b.codigo}</td><td>{b.huerto ?? '—'}</td><td>{b.cuartel ?? '—'}</td><td>{b.variedad ?? '—'}</td><td className="n">{num(b.envases)}</td><td className="n">{num(b.kilos)}</td></tr>)}</tbody>
                </table>
              </div>
            </details>
          ))}
        </div>
      )}

      {tab === 'Rechazos' && (
        <div className="tabla-wrap">
          <p className="muted">Movimientos que hicieron los teléfonos y el servidor no aplicó (por ejemplo, abrir un bin que ya estaba en uso).</p>
          <table>
            <thead><tr><th>Fecha</th><th>Movimiento</th><th>Bin</th><th>Usuario</th><th>Motivo</th></tr></thead>
            <tbody>
              {!rechazos.length && !cargando && <tr><td colSpan={5} className="muted">Sin rechazos.</td></tr>}
              {rechazos.map((e) => <tr key={e.id}><td>{fh(e.hecho_en)}</td><td>{TEXTO_EVENTO[e.tipo] ?? e.tipo}</td><td className="mono">{e.codigo}</td><td>{e.perfil?.nombre}</td><td>{e.mensaje || e.resultado}</td></tr>)}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'Cámaras y calidad' && (
        <>
          <Crud tabla="camaras" titulo="Cámaras de frío"
            ayuda="El acopio registra entrada y salida de cada bin. Se avisa cuando un bin supera los minutos de alerta."
            campos={[
              { k: 'nombre', t: 'Nombre', req: true },
              { k: 'minutos_objetivo', t: 'Minutos de enfriado esperados', tipo: 'number', def: 0, ancho: 220 },
              { k: 'minutos_alerta', t: 'Alertar después de (min)', tipo: 'number', def: 0, ancho: 200 },
              { k: 'activo', t: 'Activa', tipo: 'bool', inline: true },
            ]} />
          <Crud tabla="parametros_calidad" titulo="Parámetros de calidad en recepción" orden="orden"
            ayuda="Lo que se mide al recibir un bin (ej. % de daño, temperatura de pulpa, firmeza). Si en Reglas activas 'Pedir parámetros de calidad', los obligatorios se exigen."
            campos={[
              { k: 'nombre', t: 'Nombre', req: true },
              { k: 'unidad', t: 'Unidad', ancho: 110 },
              { k: 'tipo', t: 'Tipo', tipo: 'select', req: true, def: 'numero', ancho: 150, opciones: [
                { v: 'numero', t: 'Número decimal' }, { v: 'entero', t: 'Número entero' }, { v: 'si_no', t: 'Sí / No' }, { v: 'opcion', t: 'Lista de opciones' }] },
              { k: 'opciones', t: 'Opciones (separadas por coma)', tipo: 'lista' },
              { k: 'minimo', t: 'Mínimo', tipo: 'number', ancho: 100 },
              { k: 'maximo', t: 'Máximo', tipo: 'number', ancho: 100 },
              { k: 'especie_id', t: 'Especie', tipo: 'select', opciones: especies.filas.map((x) => ({ v: x.id, t: x.nombre })), ancho: 150 },
              { k: 'orden', t: 'Orden', tipo: 'number', def: 0, ancho: 90 },
              { k: 'obligatorio', t: 'Obligatorio', tipo: 'bool', def: false },
              { k: 'activo', t: 'Activo', tipo: 'bool', inline: true },
            ]} />
        </>
      )}
    </div>
  );
}

function DetalleBin({ b, params, esAdmin, cerrar, recargar }: { b: any; params: any[]; esAdmin: boolean; cerrar: () => void; recargar: () => void }) {
  const [urls, setUrls] = useState<string[]>([]);
  useEffect(() => {
    setUrls([]);
    if (!b.fotos?.length) return;
    supabase.storage.from('acopio-fotos').createSignedUrls(b.fotos, 3600).then(({ data }) => setUrls((data || []).map((x: any) => x.signedUrl).filter(Boolean)));
  }, [b]);

  async function anular() {
    const motivo = prompt(`Anular el bin ${b.codigo}. Motivo:`);
    if (!motivo) return;
    const { data: u } = await supabase.auth.getUser();
    const { error } = await supabase.from('eventos_bin').insert({ id: uuid(), codigo: b.codigo, tipo: 'anular', datos: { motivo }, hecho_en: new Date().toISOString(), hecho_por: u.user?.id });
    if (error) return alert(error.message);
    cerrar(); recargar();
  }

  const calidad = Object.entries(b.calidad || {});
  return (
    <div className="tarjeta">
      <div className="encabezado">
        <h3 style={{ margin: 0 }}>Bin <span className="mono">{b.codigo}</span></h3>
        <div className="acciones">
          {esAdmin && !['despachado', 'anulado'].includes(b.estado) && <button className="peligro chico" onClick={anular}>Anular</button>}
          <button className="chico" onClick={cerrar}>Cerrar</button>
        </div>
      </div>
      <div className="fila" style={{ alignItems: 'flex-start' }}>
        <div>
          <div className="muted">Recorrido</div>
          <ul style={{ margin: '.3rem 0', paddingLeft: '1.1rem', lineHeight: 1.7 }}>
            {b.abierto_en && <li>Abierto {fh(b.abierto_en)}{b.abierto_por_nombre ? ` por ${b.abierto_por_nombre}` : ''}</li>}
            {b.cerrado_en && <li>Cerrado {fh(b.cerrado_en)}</li>}
            {b.recibido_en && <li>Recibido {fh(b.recibido_en)}{b.recibido_por_nombre ? ` por ${b.recibido_por_nombre}` : ''}</li>}
            {b.camara_inicio && <li>Cámara {b.camara}: {fh(b.camara_inicio)}{b.camara_fin ? ` a ${horaCorta(b.camara_fin)}` : ' (sigue)'} · {b.minutos_camara} min</li>}
            {b.despachado_en && <li>Despachado {fh(b.despachado_en)} · {b.patente}{b.guia ? ` · guía ${b.guia}` : ''}</li>}
          </ul>
          <div className="muted">{[b.huerto, b.cuartel, b.variedad, b.envase].filter(Boolean).join(' · ')}</div>
          <div>{num(b.envases)} envases · {num(b.kilos)} kg{b.trabajadores ? ` · ${b.trabajadores} trabajadores` : ''}</div>
        </div>
        <div>
          <div className="muted">Calidad en recepción</div>
          {!calidad.length && <div className="muted">Sin datos</div>}
          {calidad.map(([k, v]) => {
            const p = params.find((x) => x.id === k);
            return <div key={k}>{p?.nombre ?? 'Parámetro'}: <b>{String(v)}</b>{p?.unidad ? ` ${p.unidad}` : ''}</div>;
          })}
          {b.observacion && <div style={{ marginTop: '.4rem' }}>Obs.: {b.observacion}</div>}
        </div>
      </div>
      {urls.length > 0 && <div className="fotos" style={{ marginTop: '.6rem' }}>{urls.map((u) => <a key={u} href={u} target="_blank" rel="noreferrer" className="foto"><img src={u} alt="" /></a>)}</div>}
    </div>
  );
}
