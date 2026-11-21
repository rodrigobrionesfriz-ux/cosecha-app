'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { db, contarPendientes, datosDeHoy, limpiarAntiguas, prepararUsuario, sincronizar } from '@/lib/offline';
import InicioDia from '@/components/campo/InicioDia';
import { hoyISO } from '@/lib/util';
import { leerMaestros, leerDia, guardarDia, Maestros, Dia, configDe, limpiarLocalesSiCorresponde } from '@/lib/campo';
import Registro from '@/components/campo/Registro';
import DiaTab from '@/components/campo/Dia';
import Credencial from '@/components/campo/Credencial';
import Resumen from '@/components/campo/Resumen';
import Sync from '@/components/campo/Sync';
import { eventosRechazados, TEXTO_EVENTO } from '@/lib/bins';
import type { EventoLocal } from '@/lib/offline';

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
  const [rechazos, setRechazos] = useState<EventoLocal[]>([]);
  const [pasoSync, setPasoSync] = useState('');
  const [errorInicio, setErrorInicio] = useState('');
  const [continuarSinDatos, setContinuarSinDatos] = useState(false);
  const syncRef = useRef(false);
  const esAdminRef = useRef(false);
  esAdminRef.current = perfil?.rol === 'admin';

  useEffect(() => {
    if (!cargando && (!session || !perfil)) location.replace('/?ir=campo');
  }, [cargando, session, perfil]);

  const recargarLocal = useCallback(async () => {
    setM(await leerMaestros());
    const p = await contarPendientes();
    setPendientes(p.mias);
    setDeOtros(p.otros);
    setRechazos(await eventosRechazados());
  }, []);

  // Sincronización solo bajo demanda: sube lo registrado y luego descarga todo de nuevo
  const sync = useCallback(async () => {
    if (syncRef.current) return;
    if (!navigator.onLine) { setUltimoSync({ ok: false, msg: 'Sin señal. Intenta donde haya cobertura.', cuando: new Date().toISOString() }); return; }
    syncRef.current = true;
    setSincronizando(true); setErrorInicio('');
    try {
      const r = await sincronizar(setPasoSync);
      await limpiarLocalesSiCorresponde();
      await limpiarAntiguas();
      const d = r.resumen;
      const subido = `Subidas ${r.entregas} entregas${r.asignaciones ? `, ${r.asignaciones} credenciales` : ''}${r.eventos ? `, ${r.eventos} movimientos de bins` : ''}.`;
      const bajado = ` Descargados ${d.trabajadores} trabajadores (${d.credenciales} con credencial), ${d.contratistas} contratistas, ${d.huertos} huertos y ${d.cuarteles} cuarteles.`;
      const corr = r.actualizadas && esAdminRef.current ? ` ${r.actualizadas} registro(s) corregido(s) por administración.` : '';
      const msg = r.errores.length ? r.errores.join(' · ') : subido + bajado + corr;
      setUltimoSync({ ok: !r.errores.length, msg, cuando: new Date().toISOString() });
      if (r.errores.length) setErrorInicio(r.errores.join(' · '));
    } catch (e: any) {
      const msg = e.message || 'Error de conexión';
      setUltimoSync({ ok: false, msg, cuando: new Date().toISOString() });
      setErrorInicio(msg);
    }
    setPasoSync('');
    await recargarLocal();
    setSincronizando(false);
    syncRef.current = false;
  }, [recargarLocal]);

  // carga inicial: solo datos del teléfono (sin descargar nada automáticamente)
  useEffect(() => {
    if (!perfil) return;
    (async () => {
      await prepararUsuario(perfil.user_id);
      setDiaState(leerDia()); // la configuración del día es de cada usuario
      try { setContinuarSinDatos(localStorage.getItem('cosecha-continuar-' + perfil.user_id) === hoyISO()); } catch {}
      setListo(true);
      await recargarLocal();
    })();
  }, [perfil, recargarLocal]);

  // solo se muestra si hay señal; no sincroniza solo
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    setOnline(navigator.onLine);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);

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
  if (perfil.rol === 'acopio') { if (typeof window !== 'undefined') location.replace('/acopio/'); return null; }
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
          <div className="t">{huerto ? `${huerto.nombre} · ${cuartel?.nombre ?? 'sin cuartel'}` : 'QSecha'}</div>
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

        {rechazos.length > 0 && (tab === 'sync' || tab === 'registro') && (
          <details className="alerta error">
            <summary>{rechazos.length} movimiento(s) de bin rechazado(s) por el servidor</summary>
            {rechazos.slice(0, 10).map((e) => <div key={e.id} style={{ marginTop: '.3rem' }}>{TEXTO_EVENTO[e.tipo]} {e.codigo.slice(-6)}: {e.mensaje || e.resultado}</div>)}
          </details>
        )}
        {deOtros > 0 && tab === 'sync' && (
          <div className="alerta aviso">Este teléfono tiene {deOtros} registro(s) sin subir de <b>otro usuario</b>. Para subirlos, ese usuario debe entrar en este teléfono y sincronizar.</div>
        )}
        {(tab === 'registro' || tab === 'dia') && !datosDeHoy(m.ultima_descarga) && !continuarSinDatos ? (
          <InicioDia online={online} ultimaDescarga={m.ultima_descarga} pendientes={pendientes} sincronizando={sincronizando}
            paso={pasoSync} error={errorInicio} onDescargar={() => sync()}
            onContinuar={() => { try { localStorage.setItem('cosecha-continuar-' + perfil.user_id, hoyISO()); } catch {} setContinuarSinDatos(true); }} />
        ) : null}
        {tab === 'registro' && (datosDeHoy(m.ultima_descarga) || continuarSinDatos) && (
          <Registro m={m} dia={dia} cfg={cfg} perfil={perfil} setDia={setDia} onCambio={recargarLocal}
            irA={(t: Tab, cod?: string) => { if (cod) setCredPrefill(cod); setTab(t); }} />
        )}
        {tab === 'resumen' && <Resumen m={m} onCambio={recargarLocal} />}
        {tab === 'credencial' && (
          <Credencial m={m} cfg={cfg} prefill={credPrefill} limpiarPrefill={() => setCredPrefill('')}
            onCambio={recargarLocal} />
        )}
        {tab === 'dia' && (datosDeHoy(m.ultima_descarga) || continuarSinDatos) && <DiaTab m={m} dia={dia} setDia={setDia} listo={() => setTab('registro')} />}
        {tab === 'sync' && (
          <Sync online={online} pendientes={pendientes} sincronizando={sincronizando} ultimo={ultimoSync}
            ultimaDescarga={m.ultima_descarga} paso={pasoSync} onSync={() => sync()} />
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
