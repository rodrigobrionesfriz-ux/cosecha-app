'use client';
import { Fragment, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { cargarTabla, useTabla } from '@/lib/datos';
import { ESTADOS_BIN, TEXTO_EVENTO } from '@/lib/bins';
import { descargarCSV, fechaCL, horaCorta, hoyISO, num, uuid } from '@/lib/util';
import Crud from '@/components/Crud';

type Tab = 'Bins' | 'Conciliación' | 'Despachos' | 'Rechazos' | 'Cámaras y calidad';
const TABS: Tab[] = ['Bins', 'Conciliación', 'Despachos', 'Rechazos', 'Cámaras y calidad'];
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
  const [pendConc, setPendConc] = useState(0);
  useEffect(() => {
    supabase.from('conciliaciones_bin').select('id', { count: 'exact', head: true }).eq('estado', 'pendiente').then(({ count }) => setPendConc(count || 0));
  }, [tab]);
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
  useEffect(() => { if (tab !== 'Cámaras y calidad' && tab !== 'Conciliación') cargar(); }, [tab, desde, hasta, estado, huertoId]); // eslint-disable-line

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
        {TABS.map((t) => <button key={t} className={tab === t ? 'activo' : ''} onClick={() => { setTab(t); setSel(null); }}>{t}{t === 'Conciliación' && pendConc > 0 ? ` (${pendConc})` : ''}</button>)}
      </div>

      {tab === 'Conciliación' && <Conciliacion esAdmin={perfil?.rol === 'admin'} onCambio={(n) => setPendConc(n)} />}

      {tab !== 'Cámaras y calidad' && tab !== 'Conciliación' && (
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
                <b>N° {d.numero} · {d.patente}{d.carro ? ` + carro ${d.carro}` : ''}</b>
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


/** Diferencias entre lo que registró el jefe en campo y lo que declaró el acopio, y alertas de bins */
function Conciliacion({ esAdmin, onCambio }: { esAdmin: boolean; onCambio: (pendientes: number) => void }) {
  const [pend, setPend] = useState<any[]>([]);
  const [hist, setHist] = useState<any[]>([]);
  const [alertas, setAlertas] = useState<{ sinCampo: any[]; despues: any[]; abiertos: any[] }>({ sinCampo: [], despues: [], abiertos: [] });
  const [cargando, setCargando] = useState(true);
  const [trabajando, setTrabajando] = useState('');
  const [error, setError] = useState('');
  const [abierta, setAbierta] = useState('');

  async function cargar() {
    setCargando(true); setError('');
    try {
      const p = await cargarTabla<any>('v_conciliaciones', '*', (q) => q.eq('estado', 'pendiente'), 'creado_en');
      const h = await cargarTabla<any>('v_conciliaciones', '*', (q) => q.neq('estado', 'pendiente').gte('resuelto_en', new Date(Date.now() - 14 * 86400000).toISOString()), 'resuelto_en');
      const hace12 = new Date(Date.now() - 12 * 3600000).toISOString();
      const cols = 'id,codigo,origen,estado,huerto,cuartel,acopio_cuartel,recibido_en,recibido_por_nombre,abierto_en,abierto_por_nombre,entregas_despues_recepcion,envases';
      const [sinCampo, despues, abiertos] = await Promise.all([
        cargarTabla<any>('v_bins', cols, (q) => q.eq('origen', 'recepcion').neq('estado', 'anulado')),
        cargarTabla<any>('v_bins', cols, (q) => q.gt('entregas_despues_recepcion', 0).neq('estado', 'anulado')),
        cargarTabla<any>('v_bins', cols, (q) => q.eq('estado', 'abierto').lt('abierto_en', hace12)),
      ]);
      setPend(p); setHist(h.reverse());
      setAlertas({ sinCampo, despues, abiertos });
      onCambio(p.length);
    } catch (e: any) { setError(e.message); }
    setCargando(false);
  }
  useEffect(() => { cargar(); }, []); // eslint-disable-line

  async function resolver(c: any, opcion: 'campo' | 'acopio' | 'descartar') {
    const txt = opcion === 'acopio'
      ? `Bin ${c.codigo}: se cambia a ${c.acopio_cuartel} el bin y sus ${c.entregas} entrega(s) (${num(c.envases)} envases). Queda registrado en la auditoría. ¿Aplicar?`
      : opcion === 'campo' ? (c.tipo === 'envases_distinto'
        ? `Bin ${c.codigo}: se dejan los ${num(c.campo?.envases)} totes registrados en campo (acopio contó ${num(c.acopio?.envases)}). ¿Confirmar?`
        : `Bin ${c.codigo}: se mantiene ${c.campo_cuartel} (dato del jefe). ¿Confirmar?`) : `¿Descartar la diferencia del bin ${c.codigo}?`;
    if (!confirm(txt)) return;
    setTrabajando(c.id);
    const { data, error } = await supabase.rpc('resolver_conciliacion', { p_id: c.id, p_opcion: opcion });
    setTrabajando('');
    if (error) return alert(error.message);
    if (opcion === 'acopio') alert(`Listo: ${(data as any)?.entregas_corregidas ?? 0} entrega(s) corregida(s).`);
    cargar();
  }

  const filasAlerta = [
    ...alertas.sinCampo.map((b) => ({ b, t: 'Sin datos de campo', d: `Recibido ${fh(b.recibido_en)} por ${b.recibido_por_nombre ?? '—'} · acopio dijo ${b.acopio_cuartel ?? '—'}` })),
    ...alertas.despues.map((b) => ({ b, t: 'Entregas después de recibido', d: `${b.entregas_despues_recepcion} entrega(s) posteriores a la recepción (${fh(b.recibido_en)}). Probablemente el jefe no cerró el bin.` })),
    ...alertas.abiertos.map((b) => ({ b, t: 'Abierto mucho tiempo', d: `Abierto ${fh(b.abierto_en)} por ${b.abierto_por_nombre ?? '—'} · ${num(b.envases)} envases` })),
  ];

  async function todosCampo() {
    if (!confirm(`¿Mantener el dato de campo en los ${pend.length} bins pendientes?`)) return;
    setTrabajando('todos');
    for (const c of pend) {
      const { error } = await supabase.rpc('resolver_conciliacion', { p_id: c.id, p_opcion: 'campo' });
      if (error) { alert(`${c.codigo}: ${error.message}`); break; }
    }
    setTrabajando('');
    cargar();
  }

  return (
    <div>
      <p className="muted" style={{ marginTop: 0 }}>
        Cuando los jefes sincronizan, cada bin se compara con lo que declaró el acopio. Si el cuartel no coincide, el sistema deja
        automáticamente el dato de campo (que es el de las entregas) y lo muestra aquí para que confirmes o apliques el del acopio.
      </p>
      {error && <div className="alerta error">{error}</div>}
      {cargando && <p className="muted">Cargando…</p>}

      <div className="encabezado" style={{ marginBottom: '.4rem' }}>
        <h2 style={{ margin: 0 }}>Pendientes ({pend.length})</h2>
        <div className="acciones">
          <button onClick={cargar}>Actualizar</button>
          {esAdmin && pend.length > 1 && <button onClick={todosCampo} disabled={!!trabajando}>Mantener campo en todos</button>}
        </div>
      </div>
      <div className="tabla-wrap">
        <table>
          <thead><tr><th>Bin</th><th>Diferencia</th><th>Campo (jefe)</th><th>Acopio</th><th className="n">Entregas</th><th>Recibido</th><th></th></tr></thead>
          <tbody>
            {!pend.length && !cargando && <tr><td colSpan={7} className="muted">Sin diferencias pendientes. ✔</td></tr>}
            {pend.map((c) => {
              const env = c.tipo === 'envases_distinto';
              return (
                <Fragment key={c.id}>
                  <tr>
                    <td className="mono">{c.codigo.slice(-8)}</td>
                    <td><span className="badge">{env ? 'Cantidad de totes' : 'Cuartel'}</span></td>
                    <td>{env ? <b>{num(c.campo?.envases)} totes</b> : <><b>{c.campo_cuartel}</b><div className="muted">{c.campo_huerto}</div></>}<div className="muted">{c.jefe ?? ''}</div></td>
                    <td>{env ? <b>{num(c.acopio?.envases)} totes</b> : <><b>{c.acopio_cuartel}</b><div className="muted">{c.acopio_huerto}</div></>}<div className="muted">{c.recibido_por_nombre ?? ''}</div></td>
                    <td className="n">{c.entregas}</td>
                    <td>{fh(c.recibido_en)}</td>
                    <td>
                      {esAdmin ? (
                        <div className="acciones" style={{ flexWrap: 'nowrap' }}>
                          {env && <button className="chico primario" onClick={() => setAbierta(abierta === c.id ? '' : c.id)}>{abierta === c.id ? 'Ocultar entregas' : 'Ver entregas'}</button>}
                          <button className="chico" disabled={!!trabajando} onClick={() => resolver(c, 'campo')}>Mantener campo</button>
                          {!env && <button className="chico primario" disabled={!!trabajando} onClick={() => resolver(c, 'acopio')}>Usar acopio</button>}
                          <button className="chico" disabled={!!trabajando} onClick={() => resolver(c, 'descartar')}>Descartar</button>
                        </div>
                      ) : <span className="muted">Solo administración</span>}
                    </td>
                  </tr>
                  {abierta === c.id && (
                    <tr><td colSpan={7}><EntregasBin binId={c.bin_id} acopio={Number(c.acopio?.envases)} onCambio={cargar} /></td></tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      <h2>Alertas</h2>
      <div className="kpis">
        <div className="kpi"><div className="v">{alertas.sinCampo.length}</div><div className="l">Recibidos sin datos de campo (el jefe no ha sincronizado)</div></div>
        <div className="kpi"><div className="v">{alertas.despues.length}</div><div className="l">Bins con entregas registradas después de recibidos</div></div>
        <div className="kpi"><div className="v">{alertas.abiertos.length}</div><div className="l">Bins abiertos hace más de 12 horas</div></div>
      </div>
      {filasAlerta.length > 0 && (
        <div className="tabla-wrap">
          <table>
            <thead><tr><th>Bin</th><th>Alerta</th><th>Cuartel</th><th>Detalle</th></tr></thead>
            <tbody>
              {filasAlerta.map(({ b, t, d }) => (
                <tr key={b.id + t}><td className="mono">{b.codigo.slice(-8)}</td><td><span className="badge">{t}</span></td><td>{b.cuartel ?? '—'}</td><td>{d}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {hist.length > 0 && (
        <details style={{ marginTop: '1rem' }}>
          <summary><b>Resueltas en los últimos 14 días ({hist.length})</b></summary>
          <div className="tabla-wrap" style={{ marginTop: '.5rem' }}>
            <table>
              <thead><tr><th>Bin</th><th>Campo</th><th>Acopio</th><th>Decisión</th><th>Por</th><th>Cuándo</th></tr></thead>
              <tbody>{hist.map((c) => (
                <tr key={c.id}><td className="mono">{c.codigo.slice(-8)}</td><td>{c.tipo === 'envases_distinto' ? `${num(c.campo?.envases)} totes` : c.campo_cuartel}</td><td>{c.tipo === 'envases_distinto' ? `${num(c.acopio?.envases)} totes` : c.acopio_cuartel}</td>
                  <td>{c.estado === 'acopio' ? 'Se usó acopio' : c.estado === 'campo' ? 'Se mantuvo campo' : 'Descartada'}{c.nota ? <div className="muted">{c.nota}</div> : null}</td>
                  <td>{c.resuelto_por_nombre ?? 'Automático'}</td><td>{fh(c.resuelto_en)}</td></tr>
              ))}</tbody>
            </table>
          </div>
        </details>
      )}
    </div>
  );
}

/** Entregas de un bin en orden de registro, para anular o ajustar la que sobra o falta */
function EntregasBin({ binId, acopio, onCambio }: { binId: string; acopio: number; onCambio: () => void }) {
  const [l, setL] = useState<any[]>([]);
  async function cargar() {
    const f = await cargarTabla<any>('entregas', 'id,leido_en,cantidad,estado,editada,t:trabajadores(nombres,apellido_paterno,apellido_materno)', (q) => q.eq('bin_id', binId), 'leido_en');
    setL(f.map((e) => ({ ...e, trabajador: e.t ? `${e.t.nombres} ${e.t.apellido_paterno ?? ''} ${e.t.apellido_materno ?? ''}`.trim() : '—' })));
  }
  useEffect(() => { cargar(); }, [binId]); // eslint-disable-line
  const total = l.filter((e) => e.estado === 'A').reduce((s, e) => s + Number(e.cantidad), 0);

  async function anular(e: any) {
    const motivo = prompt(`Anular ${e.cantidad} de ${e.trabajador}. Motivo:`, 'Conciliación con conteo de acopio');
    if (!motivo) return;
    const { error } = await supabase.rpc('anular_entrega', { p_id: e.id, p_motivo: motivo });
    if (error) return alert(error.message);
    await cargar(); onCambio();
  }
  async function ajustar(e: any) {
    const v = prompt(`Nueva cantidad para ${e.trabajador} (hoy ${e.cantidad}):`, String(e.cantidad));
    if (v == null) return;
    const n = Number(v.replace(',', '.'));
    if (!(n > 0)) return alert('Cantidad inválida');
    const { error } = await supabase.rpc('editar_entrega', { p_id: e.id, p_cambios: { cantidad: n }, p_motivo: 'Conciliación con conteo de acopio' });
    if (error) return alert(error.message);
    await cargar(); onCambio();
  }

  return (
    <div style={{ padding: '.4rem 0' }}>
      <div className="muted" style={{ marginBottom: '.3rem' }}>Campo: <b>{num(total)}</b> · Acopio contó: <b>{num(acopio)}</b>{total !== acopio ? ` · diferencia ${num(total - acopio)}` : ' · ✔ coincide'}</div>
      <table>
        <thead><tr><th>#</th><th>Hora</th><th>Trabajador</th><th className="n">Totes</th><th></th></tr></thead>
        <tbody>
          {l.map((e, i) => (
            <tr key={e.id} style={e.estado !== 'A' ? { textDecoration: 'line-through', opacity: .55 } : undefined}>
              <td className="muted">{i + 1}</td><td>{horaCorta(e.leido_en)}</td><td>{e.trabajador}</td>
              <td className="n">{num(e.cantidad)}{e.editada ? ' ✎' : ''}</td>
              <td>{e.estado === 'A' && <div className="acciones" style={{ flexWrap: 'nowrap' }}>
                <button className="chico" onClick={() => ajustar(e)}>Ajustar</button>
                <button className="chico peligro" onClick={() => anular(e)}>Anular</button>
              </div>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted" style={{ fontSize: '.85rem' }}>Al dejar el total igual al conteo de acopio, la diferencia se cierra sola. Cada cambio queda en la auditoría.</p>
    </div>
  );
}
