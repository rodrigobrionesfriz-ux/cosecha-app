'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { db, contarPendientes, descargarMaestros, limpiarAntiguas, prepararUsuario, sincronizar } from '@/lib/offline';
import { leerMaestros, leerDia, guardarDia, Maestros, Dia, configDe, limpiarLocalesSiCorresponde } from '@/lib/campo';
import Registro from '@/components/campo/Registro';
import DiaTab from '@/components/campo/Dia';
import Credencial from '@/components/campo/Credencial';
import Resumen from '@/components/campo/Resumen';
import Sync from '@/components/campo/Sync';

type Tab = 'registro' | 'dia' | 'credencial' | 'resumen' | 'sync';

export default function Campo() {
  const { session, perfil, cargando, salir } = useAuth();
  const [tab, setTab] = useState<Tab>('registro');
  const [m, setM] = useState<Maestros | null>(null);
  const [dia, setDiaState] = useState<Dia>({});
  const [online, setOnline] = useState(true);
  const [pendientes, setPendientes] = useState(0);
  const [deOtros, setDeOtros] = useState(0);
  const [listo, setListo] = useState(false);
  const [sincronizando, setSincronizando] = useState(false);
  const [ultimoSync, setUltimoSync] = useState<{ ok: boolean; msg: string; cuando: string } | null>(null);
  const [credPrefill, setCredPrefill] = useState('');
  const syncRef = useRef(false);

  useEffect(() => {
    if (!cargando && (!session || !perfil)) location.replace('/?ir=campo');
  }, [cargando, session, perfil]);

  const recargarLocal = useCallback(async () => {
    setM(await leerMaestros());
    const p = await contarPendientes();
    setPendientes(p.mias);
    setDeOtros(p.otros);
  }, []);

  const sync = useCallback(async (silencioso = false) => {
    if (syncRef.current || !navigator.onLine) return;
    syncRef.current = true;
    setSincronizando(true);
    try {
      const r = await sincronizar();
      await limpiarLocalesSiCorresponde();
      await limpiarAntiguas();
      const msg = r.errores.length ? r.errores.join(' · ') : `Subidas ${r.entregas} entregas${r.asignaciones ? ` y ${r.asignaciones} credenciales` : ''}.${r.actualizadas ? ` ${r.actualizadas} registro(s) corregido(s) por administración.` : ''} Datos actualizados.`;
      setUltimoSync({ ok: !r.errores.length, msg, cuando: new Date().toISOString() });
    } catch (e: any) {
      if (!silencioso) setUltimoSync({ ok: false, msg: e.message || 'Error de conexión', cuando: new Date().toISOString() });
    }
    await recargarLocal();
    setSincronizando(false);
    syncRef.current = false;
  }, [recargarLocal]);

  // carga inicial
  useEffect(() => {
    if (!perfil) return;
    (async () => {
      await prepararUsuario(perfil.user_id);
      setDiaState(leerDia()); // la configuración del día es de cada usuario
      setListo(true);
      await recargarLocal();
      const ult = await db.cache.get('ultima_descarga');
      if (!ult && navigator.onLine) {
        try { await descargarMaestros(); } catch {}
        await recargarLocal();
      } else if (navigator.onLine) {
        sync(true);
      }
    })();
  }, [perfil, recargarLocal, sync]);

  // conectividad y sincronización automática cada 3 minutos
  useEffect(() => {
    const on = () => { setOnline(true); sync(true); };
    const off = () => setOnline(false);
    setOnline(navigator.onLine);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    const t = setInterval(() => { if (navigator.onLine) sync(true); }, 180000);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); clearInterval(t); };
  }, [sync]);

  // mantener pantalla encendida mientras se registra
  useEffect(() => {
    let lock: any = null;
    const pedir = async () => { try { lock = await (navigator as any).wakeLock?.request('screen'); } catch {} };
    if (tab === 'registro') pedir();
    const vis = () => { if (document.visibilityState === 'visible' && tab === 'registro') pedir(); };
    document.addEventListener('visibilitychange', vis);
    return () => { document.removeEventListener('visibilitychange', vis); try { lock?.release(); } catch {} };
  }, [tab]);

  function setDia(d: Dia) { setDiaState(d); guardarDia(d); }

  if (cargando || !perfil) return <div className="campo-app"><div className="campo-body muted">Cargando…</div></div>;
  if (perfil.rol === 'consulta') {
    return <div className="login"><div className="alerta aviso">Tu usuario es de solo consulta y no puede registrar cosecha.</div><a className="btn grande" href="/admin/">Ir al panel</a></div>;
  }
  if (!m || !listo) return <div className="campo-app"><div className="campo-body muted">Preparando datos…</div></div>;

  const cfg = configDe(m, dia.huerto_id);
  const huerto = m.huertos.find((h) => h.id === dia.huerto_id);
  const cuartel = m.cuarteles.find((c) => c.id === dia.cuartel_id);

  const NAV: { k: Tab; i: string; t: string }[] = [
    { k: 'registro', i: '📷', t: 'Registrar' },
    { k: 'resumen', i: '📋', t: 'Hoy' },
    { k: 'credencial', i: '🪪', t: 'Credencial' },
    { k: 'dia', i: '⚙️', t: 'Día' },
    { k: 'sync', i: online ? '☁️' : '📴', t: 'Sincronizar' },
  ];

  return (
    <div className="campo-app">
      <div className="campo-top">
        <div>
          <div className="t">{huerto ? `${huerto.nombre} · ${cuartel?.nombre ?? 'sin cuartel'}` : 'Cosecha'}</div>
          <div className="s">{perfil.nombre} · {online ? 'en línea' : 'sin señal'}{pendientes ? ` · ${pendientes} por subir` : ''}</div>
        </div>
        <div className="top-acciones">
          {perfil.rol === 'admin' && <a href="/admin/">Panel</a>}
          <button type="button" onClick={() => {
            const aviso = pendientes
              ? `Tienes ${pendientes} registro(s) sin subir. Quedan guardados en este teléfono y se subirán cuando vuelvas a entrar con tu usuario.\n\n¿Cerrar sesión?`
              : '¿Cerrar sesión?';
            if (confirm(aviso)) salir();
          }}>Salir</button>
        </div>
      </div>

      <div className="campo-body">
        {!m.huertos.length && m.ultima_descarga && (
          <div className="alerta aviso">No hay cuarteles habilitados para cosecha. El administrador debe habilitarlos en el panel (Huertos y maestros → Cuarteles) y luego toca Sincronizar.</div>
        )}
        {!m.ultima_descarga && (
          <div className="alerta aviso">Este teléfono aún no descarga los datos. Conéctate a internet y toca <b>Sincronizar</b>.</div>
        )}
        {deOtros > 0 && tab === 'sync' && (
          <div className="alerta aviso">Este teléfono tiene {deOtros} registro(s) sin subir de <b>otro usuario</b>. Para subirlos, ese usuario debe entrar en este teléfono y sincronizar.</div>
        )}
        {tab === 'registro' && (
          <Registro m={m} dia={dia} cfg={cfg} perfil={perfil} setDia={setDia} onCambio={recargarLocal}
            irA={(t: Tab, cod?: string) => { if (cod) setCredPrefill(cod); setTab(t); }} />
        )}
        {tab === 'resumen' && <Resumen m={m} onCambio={recargarLocal} />}
        {tab === 'credencial' && (
          <Credencial m={m} cfg={cfg} prefill={credPrefill} limpiarPrefill={() => setCredPrefill('')}
            onCambio={async () => { await recargarLocal(); if (navigator.onLine) sync(true); }} />
        )}
        {tab === 'dia' && <DiaTab m={m} dia={dia} setDia={setDia} listo={() => setTab('registro')} />}
        {tab === 'sync' && (
          <Sync online={online} pendientes={pendientes} sincronizando={sincronizando} ultimo={ultimoSync}
            ultimaDescarga={m.ultima_descarga} onSync={() => sync(false)} />
        )}
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
