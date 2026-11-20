'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { db, contarPendientes, descargarMaestros, EventoLocal, limpiarAntiguas, prepararUsuario, sincronizar } from '@/lib/offline';
import { leerMaestros, Maestros } from '@/lib/campo';
import { eventosRechazados, TEXTO_EVENTO } from '@/lib/bins';
import { hoyISO, num } from '@/lib/util';
import Recibir from '@/components/acopio/Recibir';
import Armar from '@/components/acopio/Armar';
import Camara from '@/components/acopio/Camara';
import Despacho from '@/components/acopio/Despacho';
import Sync from '@/components/campo/Sync';

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
    setHoy({ recibidos: c('recibir'), armados: c('armar'), camara: c('camara_entrada'), despachados: c('despachar') });
  }, []);

  const sync = useCallback(async (silencioso = false) => {
    if (syncRef.current || !navigator.onLine) return;
    syncRef.current = true;
    setSincronizando(true);
    try {
      const r = await sincronizar();
      await limpiarAntiguas();
      const msg = r.errores.length ? r.errores.join(' · ') : `Subidos ${r.eventos} movimientos de bins. Datos actualizados.`;
      setUltimoSync({ ok: !r.errores.length, msg, cuando: new Date().toISOString() });
    } catch (e: any) {
      if (!silencioso) setUltimoSync({ ok: false, msg: e.message || 'Error de conexión', cuando: new Date().toISOString() });
    }
    await recargarLocal();
    setSincronizando(false);
    syncRef.current = false;
  }, [recargarLocal]);

  useEffect(() => {
    if (!perfil) return;
    (async () => {
      await prepararUsuario(perfil.user_id);
      await recargarLocal();
      const ult = await db.cache.get('ultima_descarga');
      if (!ult && navigator.onLine) { try { await descargarMaestros(); } catch {} await recargarLocal(); }
      else if (navigator.onLine) sync(true);
    })();
  }, [perfil, recargarLocal, sync]);

  // sincronización automática cada 2 minutos: en acopio importa ver los bins que llegan del campo
  useEffect(() => {
    const on = () => { setOnline(true); sync(true); };
    const off = () => setOnline(false);
    setOnline(navigator.onLine);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    const t = setInterval(() => { if (navigator.onLine) sync(true); }, 120000);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); clearInterval(t); };
  }, [sync]);

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

  const NAV: { k: Tab; i: string; t: string }[] = [
    { k: 'recibir', i: '📥', t: 'Recibir' },
    { k: 'armar', i: '🧺', t: 'Armar' },
    { k: 'camara', i: '❄️', t: 'Cámara' },
    { k: 'despacho', i: '🚚', t: 'Despacho' },
    { k: 'sync', i: online ? '☁️' : '📴', t: 'Sincronizar' },
  ];

  return (
    <div className="campo-app">
      <div className="campo-top">
        <div>
          <div className="t">Acopio</div>
          <div className="s">{perfil.nombre} · {online ? 'en línea' : 'sin señal'}{pendientes ? ` · ${pendientes} por subir` : ''}</div>
        </div>
        <div className="top-acciones">
          {perfil.rol === 'admin' && <a href="/admin/acopio/">Panel</a>}
          <button type="button" onClick={() => { if (confirm(pendientes ? `Tienes ${pendientes} registro(s) sin subir. Quedan en el teléfono. ¿Cerrar sesión?` : '¿Cerrar sesión?')) salir(); }}>Salir</button>
        </div>
      </div>

      <div className="campo-body">
        {!m.ultima_descarga && <div className="alerta aviso">Este teléfono aún no descarga los datos. Conéctate a internet y toca <b>Sincronizar</b>.</div>}
        <div className="contexto">
          <span>Hoy</span>
          <span><b>{num(hoy.recibidos + hoy.armados)}</b> recibidos · <b>{hoy.camara}</b> a cámara · <b>{hoy.despachados}</b> despachados</span>
        </div>
        {rechazos.length > 0 && (
          <details className="alerta error">
            <summary>{rechazos.length} movimiento(s) rechazado(s) por el servidor</summary>
            {rechazos.slice(0, 10).map((e) => <div key={e.id} style={{ marginTop: '.3rem' }}>{TEXTO_EVENTO[e.tipo]} {e.codigo.slice(-6)}: {e.mensaje || e.resultado}</div>)}
          </details>
        )}
        {tab === 'recibir' && <Recibir m={m} perfil={perfil} onCambio={recargarLocal} />}
        {tab === 'armar' && <Armar m={m} perfil={perfil} onCambio={recargarLocal} />}
        {tab === 'camara' && <Camara m={m} onCambio={recargarLocal} />}
        {tab === 'despacho' && <Despacho m={m} perfil={perfil} onCambio={recargarLocal} />}
        {tab === 'sync' && <Sync online={online} pendientes={pendientes} sincronizando={sincronizando} ultimo={ultimoSync} ultimaDescarga={m.ultima_descarga} onSync={() => sync(false)} />}
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
