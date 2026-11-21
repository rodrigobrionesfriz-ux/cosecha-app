'use client';
import { useEffect, useState } from 'react';
import { db, idDispositivo, usuarioActual } from '@/lib/offline';
import { useAuth } from '@/lib/auth';
import { equipoLocal, fijarOperador, olvidarEquipo, operadorActual } from '@/lib/equipo';
import { horaCorta } from '@/lib/util';

const RESULTADOS: Record<string, string> = {
  CR: 'Asignada', DR: 'El trabajador ya tenía otra credencial', DC: 'Credencial en uso por otro trabajador',
  CI: 'Credencial no existe o está anulada', RI: 'RUT inválido', TB: 'Trabajador bloqueado', TN: 'Trabajador nuevo sin nombre',
};

export default function Sync({ online, pendientes, sincronizando, ultimo, ultimaDescarga, paso, onSync }: {
  online: boolean; pendientes: number; sincronizando: boolean; paso?: string;
  ultimo: { ok: boolean; msg: string; cuando: string } | null; ultimaDescarga: string | null; onSync: () => void;
}) {
  const { perfil, salir } = useAuth();
  const [asig, setAsig] = useState<any[]>([]);
  const [instalable, setInstalable] = useState<any>(null);

  useEffect(() => {
    db.asignaciones.toArray().then((l) => setAsig(l.filter((a) => !a.usuario || a.usuario === usuarioActual()).sort((a, b) => b.creado_en.localeCompare(a.creado_en)).slice(0, 30)));
  }, [pendientes, sincronizando]);

  useEffect(() => {
    const h = (e: any) => { e.preventDefault(); setInstalable(e); };
    window.addEventListener('beforeinstallprompt', h);
    return () => window.removeEventListener('beforeinstallprompt', h);
  }, []);

  const conProblema = asig.filter((a) => a.sync && a.resultado && a.resultado !== 'CR');

  return (
    <div>
      <div className={`alerta ${online ? 'ok' : 'aviso'}`}>
        {online ? 'Con conexión.' : 'Sin señal. Todo queda guardado en el teléfono; sincroniza cuando tengas cobertura.'}
      </div>
      <div className="kpis" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <div className="kpi"><div className="v">{pendientes}</div><div className="l">Registros por subir</div></div>
        <div className="kpi"><div className="v">{ultimaDescarga ? horaCorta(ultimaDescarga) : '—'}</div><div className="l">Última actualización{ultimaDescarga ? ` · ${new Date(ultimaDescarga).toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit', timeZone: 'America/Santiago' })}` : ''}</div></div>
      </div>
      <button className="primario grande" onClick={onSync} disabled={!online || sincronizando}>
        {sincronizando ? 'Sincronizando…' : 'Sincronizar ahora'}
      </button>
      <p className="muted" style={{ fontSize: '.88rem' }}>La app no sincroniza sola. Al tocar Sincronizar: 1) sube los registros de cosecha, credenciales y bins, 2) descarga de nuevo trabajadores, contratistas, huertos y cuarteles, 3) trae los cambios hechos en la nube.</p>
      {sincronizando && paso && <div className="alerta info">{paso}</div>}
      {ultimo && <div className={`alerta ${ultimo.ok ? 'ok' : 'error'}`}>{horaCorta(ultimo.cuando)} · {ultimo.msg}</div>}

      {conProblema.length > 0 && (
        <>
          <h3>Credenciales rechazadas por el servidor</h3>
          <ul className="lista-entregas">
            {conProblema.map((a) => (
              <li key={a.id}><span>{a.nombres || a.rut}<br /><span className="muted mono">{a.codigo}</span></span><span className="badge err">{RESULTADOS[a.resultado] || a.resultado}</span></li>
            ))}
          </ul>
          <p className="muted">Las entregas de estos trabajadores quedan pendientes hasta corregir la credencial.</p>
        </>
      )}

      {instalable && (
        <button className="grande" style={{ marginTop: '1rem' }} onClick={() => { instalable.prompt(); setInstalable(null); }}>📲 Instalar app en este teléfono</button>
      )}

      {perfil && !perfil.email ? (
        <div className="tarjeta" style={{ marginTop: '1.2rem' }}>
          <div className="muted">Equipo: <b>{perfil.nombre.replace(/^Equipo /, '')}</b>{equipoLocal()?.imei ? <> · IMEI <span className="mono">{equipoLocal()?.imei}</span></> : null}</div>
          <div className="muted">{operadorActual()?.rol === 'acopio' ? 'Operador' : 'Jefe'}: <b>{operadorActual()?.nombre ?? '—'}</b></div>
          <div className="muted">Empresa: {perfil.empresa?.nombre}</div>
          <button className="chico" style={{ marginTop: '.6rem' }} disabled={!operadorActual()} onClick={() => {
            const op = operadorActual();
            if (!op || !confirm(`¿Cerrar la sesión de ${op.nombre}? Lo registrado queda guardado en el teléfono.`)) return;
            fijarOperador(null);
            location.reload();
          }}>Cerrar sesión de {operadorActual()?.nombre ?? 'jefe'}</button>
          <details style={{ marginTop: '.8rem' }}>
            <summary className="muted" style={{ fontSize: '.85rem' }}>Desvincular este teléfono</summary>
            <p className="muted" style={{ fontSize: '.85rem' }}>Borra el registro del equipo en este teléfono. Para volver a usarlo habrá que registrarlo otra vez y que administración lo apruebe.</p>
            <button className="chico peligro" onClick={async () => {
              if (pendientes) { alert(`Hay ${pendientes} registro(s) sin subir. Sincroniza antes de desvincular.`); return; }
              if (prompt('Escribe DESVINCULAR para confirmar') !== 'DESVINCULAR') return;
              fijarOperador(null);
              olvidarEquipo();
              await salir();
            }}>Desvincular equipo</button>
          </details>
        </div>
      ) : (
        <div className="tarjeta" style={{ marginTop: '1.2rem' }}>
          <div className="muted">Usuario: <b>{perfil?.nombre}</b> ({perfil?.email})</div>
          <div className="muted">Empresa: {perfil?.empresa?.nombre}</div>
          <div className="muted">Dispositivo: <span className="mono">{idDispositivo()}</span></div>
          <button className="chico" style={{ marginTop: '.6rem' }} onClick={() => {
            if (pendientes && !confirm(`Hay ${pendientes} registros sin subir. Si sales, siguen guardados en el teléfono. ¿Salir?`)) return;
            salir();
          }}>Cerrar sesión</button>
        </div>
      )}
    </div>
  );
}
