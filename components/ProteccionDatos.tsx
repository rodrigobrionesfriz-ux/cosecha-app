'use client';
import { MutableRefObject, useCallback, useEffect, useRef, useState } from 'react';
import { subirPendientes } from '@/lib/offline';
import { descargarRespaldo, EstadoAlmacen, nivelAntiguedad, pedirPersistencia, pendienteMasAntiguo } from '@/lib/proteccion';
import { horaCorta } from '@/lib/util';

const CADA_MS = 3 * 60 * 1000; // revisa cada 3 minutos si hay algo por subir y señal

/**
 * Subida automática silenciosa: con señal sube lo pendiente (no descarga nada ni cambia la pantalla).
 * Usa el mismo candado que el botón Sincronizar para no correr dos a la vez.
 */
export function useProteccion({ syncRef, pendientes, onSubido }: {
  syncRef: MutableRefObject<boolean>; pendientes: number; onSubido: () => Promise<void> | void;
}) {
  const [almacen, setAlmacen] = useState<EstadoAlmacen | null>(null);
  const [pendDesde, setPendDesde] = useState<string | null>(null);
  const [ahora, setAhora] = useState(Date.now());
  const [subiendo, setSubiendo] = useState(false);
  const pendRef = useRef(pendientes);
  pendRef.current = pendientes;

  useEffect(() => { pedirPersistencia().then(setAlmacen); }, []);
  useEffect(() => { pendienteMasAntiguo().then(setPendDesde); }, [pendientes]);
  useEffect(() => { const t = setInterval(() => setAhora(Date.now()), 60000); return () => clearInterval(t); }, []);

  const subir = useCallback(async () => {
    if (syncRef.current || !navigator.onLine || !pendRef.current) return;
    syncRef.current = true; setSubiendo(true);
    try { await subirPendientes(); } catch { /* sin señal real o error: se reintenta en la próxima vuelta */ }
    syncRef.current = false; setSubiendo(false);
    await onSubido();
  }, [syncRef, onSubido]);

  useEffect(() => {
    const t = setInterval(subir, CADA_MS);
    const alVolver = () => { if (document.visibilityState === 'visible') subir(); };
    window.addEventListener('online', subir);
    document.addEventListener('visibilitychange', alVolver);
    const primera = setTimeout(subir, 5000);
    return () => { clearInterval(t); clearTimeout(primera); window.removeEventListener('online', subir); document.removeEventListener('visibilitychange', alVolver); };
  }, [subir]);

  return { almacen, pendDesde, nivel: nivelAntiguedad(pendDesde, ahora), subiendo };
}

/** Aviso en pantalla cuando lo pendiente lleva horas sin subir */
export function AvisoAntiguedad({ nivel, desde, online, onSync }: { nivel: 'ok' | 'aviso' | 'urgente'; desde: string | null; online: boolean; onSync: () => void }) {
  if (nivel === 'ok' || !desde) return null;
  const dia = new Date(desde).toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit', timeZone: 'America/Santiago' });
  return (
    <div className={`alerta ${nivel === 'urgente' ? 'error' : 'aviso'}`} style={{ display: 'flex', gap: '.6rem', alignItems: 'center', justifyContent: 'space-between' }}>
      <span>Hay registros sin subir desde las <b>{horaCorta(desde)}</b> ({dia}). {online ? 'Sincroniza ahora.' : 'Busca señal para subirlos; si el teléfono falla antes, se pierden.'}</span>
      {online && <button className="chico" onClick={onSync}>Sincronizar</button>}
    </div>
  );
}

/** Estado del almacenamiento y respaldo de emergencia (pestaña Sincronizar) */
export function PanelProteccion({ almacen, pendientes, empresaId, nombre }: { almacen: EstadoAlmacen | null; pendientes: number; empresaId: string; nombre: string }) {
  const [msg, setMsg] = useState<{ t: string; m: string } | null>(null);
  const [trabajando, setTrabajando] = useState(false);

  async function respaldar() {
    setTrabajando(true); setMsg(null);
    try {
      const r = await descargarRespaldo(empresaId, nombre);
      setMsg({ t: 'ok', m: r.via === 'compartido'
        ? `Respaldo con ${r.total} registro(s) compartido. Envíalo al administrador para cargarlo en el panel.`
        : `Respaldo con ${r.total} registro(s) guardado en Descargas. Envíalo al administrador para cargarlo en el panel.` });
    } catch (e: any) { setMsg({ t: 'error', m: e.message || 'No se pudo crear el respaldo' }); }
    setTrabajando(false);
  }

  return (
    <div className="tarjeta" style={{ marginTop: '1rem' }}>
      <h3 style={{ marginTop: 0 }}>Protección de datos</h3>
      {almacen?.persistente === true && <div className="alerta ok">Almacenamiento protegido: el teléfono no borrará estos datos aunque se quede sin espacio.</div>}
      {almacen?.persistente === false && <div className="alerta aviso">Almacenamiento no protegido. Instala la app en el teléfono (menú de Chrome → Instalar app) para que Chrome no borre datos si falta espacio.</div>}
      {almacen?.libreMB != null && <p className="muted" style={{ fontSize: '.85rem', marginTop: 0 }}>Espacio disponible para la app: {almacen.libreMB.toLocaleString('es-CL')} MB.</p>}
      <p className="muted" style={{ fontSize: '.85rem' }}>
        Lo registrado se sube solo cuando hay señal. No borres los datos de Chrome ni uses modo incógnito. Si el teléfono va a ir a reparación o cambio y no hay señal, saca un respaldo y envíalo al administrador.
      </p>
      <button className="grande" onClick={respaldar} disabled={trabajando || !pendientes}>
        {trabajando ? 'Preparando respaldo…' : `💾 Respaldo de emergencia${pendientes ? ` (${pendientes})` : ''}`}
      </button>
      {!pendientes && <p className="muted" style={{ fontSize: '.82rem', marginBottom: 0 }}>No hay nada pendiente: todo está en la nube.</p>}
      {msg && <div className={`alerta ${msg.t}`} style={{ marginTop: '.6rem' }}>{msg.m}</div>}
    </div>
  );
}
