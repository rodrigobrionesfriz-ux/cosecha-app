'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { db, contarPendientes, datosDeHoy, EventoLocal, limpiarAntiguas, prepararUsuario, sincronizar } from '@/lib/offline';
import { leerMaestros, Maestros } from '@/lib/campo';
import { eventosRechazados, TEXTO_EVENTO } from '@/lib/bins';
import { hoyISO, num } from '@/lib/util';
import Recibir from '@/components/acopio/Recibir';
import Armar from '@/components/acopio/Armar';
import Camara from '@/components/acopio/Camara';
import Despacho from '@/components/acopio/Despacho';
import Sync from '@/components/campo/Sync';
import { AvisoAntiguedad, ProteccionAdmin, useProteccion } from '@/components/ProteccionDatos';
import SeleccionOperador from '@/components/SeleccionOperador';
import { fijarOperador, Operador, operadorActual } from '@/lib/equipo';

type Tab = 'recibir' | 'armar' | 'camara' | 'despacho' | 'sync';

export default function Acopio() {
  const { session, perfil, cargando, salir } = useAuth();
  const [tab, setTab] = useState<Tab>('recibir');
  const [m, setM] = useState<Maestros | null>(null);
  const [online, setOnline] = useState(true);
  const [pendientes, setPendientes] = useState(0);
  const [sincronizando, setSincronizando] = useState(false);
  const [ultimoSync, setUltimoSync] = useState<{ ok: boolean; msg: string; cuando: string } | null>(null);
  const [rechazos, setRechazos] = useState<EventoLocal[]>([]);
  const [hoy, setHoy] = useState({ recibidos: 0, armados: 0, camara: 0, despachados: 0 });
  const syncRef = useRef(false);
  const [op, setOp] = useState<Operador | null>(null);

  useEffect(() => {
    if (!cargando && (!session || !perfil)) location.replace('/?ir=acopio');
  }, [cargando, session, perfil]);

  const recargarLocal = useCallback(async () => {
    setM(await leerMaestros());
    setPendientes((await contarPendientes()).mias);
    setRechazos(await eventosRechazados());
    const inicio = new Date(hoyISO() + 'T00:00:00-03:00').toISOString();
    const ev = (await db.eventos.where('hecho_en').above(inicio).toArray()).filter((e) => !e.resultado || e.resultado === 'OK');
    const c = (t: string) => ev.filter((e) => e.tipo === t).length;
    setHoy({ recibidos: c('recibir') - c('deshacer_recepcion'), armados: c('armar'), camara: c('camara_entrada'), despachados: c('despachar') - c('quitar_despacho') });
  }, []);

  const sync = useCallback(async (silencioso = false) => {
    if (syncRef.current || !navigator.onLine) return;
    syncRef.current = true;
    setSincronizando(true);
    try {
      const r = await sincronizar();
      await limpiarAntiguas();
      const msg = r.errores.length ? r.errores.join(' · ') : `Subidos ${r.eventos} movimientos de bins. Descargados ${r.resumen.trabajadores} trabajadores, ${r.resumen.huertos} huertos y ${r.resumen.cuarteles} cuarteles; bins en curso actualizados.`;
      setUltimoSync({ ok: !r.errores.length, msg, cuando: new Date().toISOString() });
    } catch (e: any) {
      if (!silencioso) setUltimoSync({ ok: false, msg: e.message || 'Error de conexión', cuando: new Date().toISOString() });
    }
    await recargarLocal();
    setSincronizando(false);
    syncRef.current = false;
  }, [recargarLocal]);

  // subida automática con señal, almacenamiento persistente y aviso de antigüedad
  const prot = useProteccion({ syncRef, pendientes, onSubido: recargarLocal });

  useEffect(() => {
    if (!perfil) return;
    (async () => {
      await prepararUsuario(perfil.user_id);
      setOp(operadorActual());
      await recargarLocal();
    })();
  }, [perfil, recargarLocal]);

  // sin sincronización automática: solo se muestra el estado de la señal
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    setOnline(navigator.onLine);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);

  useEffect(() => {
    let lock: any = null;
    (async () => { try { lock = await (navigator as any).wakeLock?.request('screen'); } catch {} })();
    return () => { try { lock?.release(); } catch {} };
  }, [tab]);

  if (cargando || !perfil) return <div className="campo-app"><div className="campo-body muted">Cargando…</div></div>;
  if (!['admin', 'acopio'].includes(perfil.rol)) {
    return <div className="login"><div className="alerta aviso">Tu usuario no tiene acceso a la app de acopio.</div><a className="btn grande" href="/">Volver</a></div>;
  }
  if (!m) return <div className="campo-app"><div className="campo-body muted">Preparando datos…</div></div>;

  // Sin cámaras de frío activas (caso La Cabaña) el flujo es recibir → despacho a packing
  const conCamara = (m.camaras || []).some((c: any) => c.activo !== false);
  const NAV: { k: Tab; i: string; t: string }[] = [
    { k: 'recibir', i: '📥', t: 'Recibir' },
    { k: 'armar', i: '🧺', t: 'Armar' },
    ...(conCamara ? [{ k: 'camara' as Tab, i: '❄️', t: 'Cámara' }] : []),
    { k: 'despacho', i: '🚚', t: 'Despacho' },
    { k: 'sync', i: online ? '☁️' : '📴', t: 'Sincronizar' },
  ];

  return (
    <div className="campo-app">
      <div className={`campo-top ${prot.nivel !== 'ok' && perfil.rol === 'admin' ? 'pend-' + prot.nivel : ''}`}>
        <div>
          <div className="t">Acopio</div>
          <div className="s">{!perfil.email ? `${op?.nombre ?? 'Sin operador'} · ${perfil.nombre.replace(/^Equipo /, '')}` : perfil.nombre} · {online ? 'en línea' : 'sin señal'}{pendientes ? ` · ${pendientes} por subir` : ''}{prot.subiendo ? ' · subiendo…' : ''}</div>
        </div>
        <div className="top-acciones">
          {perfil.rol === 'admin' && <a href="/admin/acopio/">Panel</a>}
          {!perfil.email ? (
            <button type="button" onClick={() => { if (op && confirm(`¿Cerrar la sesión de ${op.nombre}? Lo registrado queda guardado.`)) { fijarOperador(null); setOp(null); } }}>Salir ({op?.nombre?.split(' ')[0] ?? 'operador'})</button>
          ) : <button type="button" onClick={() => { if (confirm(pendientes ? `Tienes ${pendientes} registro(s) sin subir. Quedan en el teléfono. ¿Cerrar sesión?` : '¿Cerrar sesión?')) salir(); }}>Salir</button>}
        </div>
      </div>

      <div className="campo-body">
        {tab !== 'sync' && perfil.rol === 'admin' && <AvisoAntiguedad nivel={prot.nivel} desde={prot.pendDesde} online={online} onSync={() => sync(false)} />}
        {!datosDeHoy(m.ultima_descarga) && tab !== 'sync' && (
          <div className="alerta aviso">
            Los datos del teléfono no son de hoy. Con señal, toca <b>Sincronizar</b> para traer los bins que vienen del campo.
            <div style={{ marginTop: '.5rem' }}><button className="primario" disabled={!online || sincronizando} onClick={() => sync(false)}>{sincronizando ? 'Sincronizando…' : 'Sincronizar ahora'}</button></div>
          </div>
        )}
        <div className="contexto">
          <span>Hoy</span>
          <span><b>{num(hoy.recibidos + hoy.armados)}</b> recibidos · {conCamara && <><b>{hoy.camara}</b> a cámara · </>}<b>{hoy.despachados}</b> despachados</span>
        </div>
        {rechazos.length > 0 && (
          <details className="alerta error">
            <summary>{rechazos.length} movimiento(s) rechazado(s) por el servidor</summary>
            {rechazos.slice(0, 10).map((e) => <div key={e.id} style={{ marginTop: '.3rem' }}>{TEXTO_EVENTO[e.tipo]} {e.codigo.slice(-6)}: {e.mensaje || e.resultado}</div>)}
          </details>
        )}
        {!perfil.email && !op && tab !== 'sync' && (
          m.ultima_descarga
            ? <SeleccionOperador operadores={m.operadores || []} rol="acopio" equipo={perfil.nombre} onListo={() => setOp(operadorActual())} />
            : <div className="alerta aviso">Primero sincroniza con señal para descargar los operadores.</div>
        )}
        {(perfil.email || op) && tab === 'recibir' && <Recibir m={m} perfil={perfil} onCambio={recargarLocal} />}
        {(perfil.email || op) && tab === 'armar' && <Armar m={m} perfil={perfil} onCambio={recargarLocal} />}
        {(perfil.email || op) && tab === 'camara' && conCamara && <Camara m={m} onCambio={recargarLocal} />}
        {(perfil.email || op) && tab === 'despacho' && <Despacho m={m} perfil={perfil} onCambio={recargarLocal} />}
        {tab === 'sync' && <Sync online={online} pendientes={pendientes} sincronizando={sincronizando} ultimo={ultimoSync} ultimaDescarga={m.ultima_descarga} onSync={() => sync(false)} />}
        {tab === 'sync' && <ProteccionAdmin esAdmin={perfil.rol === 'admin'} almacen={prot.almacen} pendientes={pendientes} empresaId={perfil.empresa_id} nombre={op?.nombre || perfil.nombre} />}
      </div>

      <div className="campo-nav">
        {NAV.map((n) => (
          <button key={n.k} className={tab === n.k ? 'activo' : ''} onClick={() => setTab(n.k)}>
            <span className="i">{n.i}</span>
            <span>{n.t}{n.k === 'sync' && pendientes > 0 && <span className="dot">{pendientes}</span>}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
