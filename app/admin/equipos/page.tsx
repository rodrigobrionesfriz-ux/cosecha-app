'use client';
import { useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { useTabla } from '@/lib/datos';
import { fechaCL, horaCorta } from '@/lib/util';

const fh = (iso?: string | null) => (iso ? `${fechaCL(iso)} ${horaCorta(iso)}` : '—');
const ESTADO: Record<string, string> = { pendiente: 'Pendiente', aprobado: 'Aprobado', bloqueado: 'Bloqueado' };

/** Modelo legible a partir del user agent del teléfono */
function modelo(ua?: string | null) {
  if (!ua) return '';
  const m = ua.match(/Android [\d.]+; ([^;)]+)/);
  return m ? m[1].replace(/ Build.*/, '') : ua.slice(0, 40);
}

export default function Equipos() {
  const { perfil } = useAuth();
  const esAdmin = perfil?.rol === 'admin';
  const eq = useTabla<any>('equipos', '*', 'solicitado_en');
  const [trabajando, setTrabajando] = useState('');
  const [tipos, setTipos] = useState<Record<string, string>>({});

  async function aprobar(e: any) {
    const nombre = prompt('Nombre del equipo:', e.nombre);
    if (nombre == null) return;
    const tipo = tipos[e.id] || e.tipo;
    setTrabajando(e.id);
    const { error } = await supabase.rpc('aprobar_equipo', { p_id: e.id, p_tipo: tipo, p_nombre: nombre });
    setTrabajando('');
    if (error) return alert(error.message);
    eq.recargar();
  }
  async function bloquear(e: any) {
    if (!confirm(`¿Bloquear el equipo ${e.nombre}? Deja de poder sincronizar hasta que lo apruebes de nuevo.`)) return;
    setTrabajando(e.id);
    const { error } = await supabase.rpc('bloquear_equipo', { p_id: e.id });
    setTrabajando('');
    if (error) return alert(error.message);
    eq.recargar();
  }

  const lista = [...eq.filas].sort((a, b) => (a.estado === 'pendiente' ? -1 : 0) - (b.estado === 'pendiente' ? -1 : 0) || a.nombre.localeCompare(b.nombre));
  const pendientes = eq.filas.filter((x) => x.estado === 'pendiente').length;

  return (
    <div>
      <div className="encabezado"><h1>Equipos</h1><div className="acciones"><button onClick={eq.recargar}>Actualizar</button></div></div>
      <p className="muted" style={{ marginTop: 0 }}>
        Teléfonos de campo y acopio. Cada uno se registra con su IMEI desde la app (botón "Registrar este teléfono como equipo")
        y queda pendiente hasta que lo apruebes. Luego los jefes u operadores entran eligiendo su nombre y su PIN (se crean en <a href="/admin/usuarios/">Usuarios</a>).
      </p>
      {pendientes > 0 && <div className="alerta aviso">{pendientes} equipo(s) esperando aprobación. Verifica el IMEI con el teléfono en la mano antes de aprobar.</div>}
      <div className="tabla-wrap">
        <table>
          <thead><tr><th>Equipo</th><th>Uso</th><th>IMEI</th><th>Modelo</th><th>Estado</th><th>Solicitado</th><th>Última conexión</th><th></th></tr></thead>
          <tbody>
            {!lista.length && !eq.cargando && <tr><td colSpan={8} className="muted">Aún no hay equipos registrados.</td></tr>}
            {lista.map((e) => (
              <tr key={e.id}>
                <td><b>{e.nombre}</b></td>
                <td>
                  {esAdmin ? (
                    <select value={tipos[e.id] || e.tipo} onChange={(x) => setTipos({ ...tipos, [e.id]: x.target.value })} style={{ minWidth: 100 }}>
                      <option value="campo">Campo</option>
                      <option value="acopio">Acopio</option>
                    </select>
                  ) : e.tipo === 'acopio' ? 'Acopio' : 'Campo'}
                  {e.estado === 'aprobado' && tipos[e.id] && tipos[e.id] !== e.tipo && <div className="muted" style={{ fontSize: '.8rem' }}>Toca Editar para aplicar</div>}
                </td>
                <td className="mono">{e.imei}</td>
                <td className="muted">{modelo(e.modelo)}</td>
                <td><span className={`badge ${e.estado === 'aprobado' ? 'ok' : e.estado === 'bloqueado' ? 'err' : ''}`}>{ESTADO[e.estado]}</span></td>
                <td>{fh(e.solicitado_en)}</td>
                <td>{fh(e.ultima_conexion)}</td>
                <td>
                  {esAdmin && (
                    <div className="acciones" style={{ flexWrap: 'nowrap' }}>
                      {e.estado !== 'aprobado' && <button className="chico primario" disabled={trabajando === e.id} onClick={() => aprobar(e)}>Aprobar</button>}
                      {e.estado === 'aprobado' && <button className="chico" disabled={trabajando === e.id} onClick={() => aprobar(e)}>Editar</button>}
                      {e.estado !== 'bloqueado' && <button className="chico peligro" disabled={trabajando === e.id} onClick={() => bloquear(e)}>Bloquear</button>}
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
