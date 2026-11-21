'use client';
import { useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { errorAmigable, useTabla } from '@/lib/datos';
import { fechaCL } from '@/lib/util';
import Operadores from '@/components/Operadores';

const ROLES: Record<string, string> = { admin: 'Administrador', jefe: 'Jefe de cuadrilla (terreno)', acopio: 'Operador de acopio', administrativo: 'Administrativo (ingreso de personal)', consulta: 'Solo consulta' };

export default function Usuarios() {
  const { perfil } = useAuth();
  const esAdmin = perfil?.rol === 'admin';
  const perfiles = useTabla<any>('perfiles', '*', 'nombre');
  const inv = useTabla<any>('invitaciones', '*', 'created_at');
  const [nuevo, setNuevo] = useState({ email: '', nombre: '', rol: 'jefe' });
  const [msg, setMsg] = useState<{ t: string; m: string } | null>(null);

  async function invitar(e: React.FormEvent) {
    e.preventDefault();
    const { error } = await supabase.from('invitaciones').upsert({
      email: nuevo.email.trim().toLowerCase(), nombre: nuevo.nombre.trim(), rol: nuevo.rol, empresa_id: perfil!.empresa_id, usada_en: null,
    });
    if (error) { setMsg({ t: 'error', m: errorAmigable(error.message) }); return; }
    setMsg({ t: 'ok', m: `Listo. Pide a ${nuevo.nombre} que entre a ${location.origin}, toque "Crear cuenta" y use el correo ${nuevo.email}.` });
    setNuevo({ email: '', nombre: '', rol: 'jefe' });
    inv.recargar();
  }

  async function actualizar(p: any, cambios: any) {
    if (p.user_id === perfil?.user_id && (cambios.rol && cambios.rol !== 'admin' || cambios.activo === false)) {
      if (!confirm('Estás cambiando tu propio acceso. ¿Continuar?')) return;
    }
    const { error } = await supabase.from('perfiles').update(cambios).eq('user_id', p.user_id);
    if (error) alert(errorAmigable(error.message));
    perfiles.recargar();
  }

  const pendientes = inv.filas.filter((i) => !i.usada_en);

  return (
    <div>
      <h1>Usuarios</h1>
      <Operadores esAdmin={esAdmin} />
      <h2>Usuarios con correo</h2>
      <p className="muted" style={{ marginTop: 0 }}>Administración, consulta, y quien prefiera entrar con correo y clave. Los teléfonos de equipos se gestionan en <a href="/admin/equipos/">Equipos</a>.</p>
      {esAdmin && (
        <form className="tarjeta" onSubmit={invitar}>
          <h3 style={{ marginTop: 0 }}>Invitar usuario</h3>
          <p className="muted" style={{ marginTop: 0 }}>Solo pueden crear cuenta los correos invitados. Al registrarse quedan asociados a esta empresa con el rol elegido.</p>
          <div className="fila">
            <div className="campo"><label>Nombre</label><input required value={nuevo.nombre} onChange={(e) => setNuevo({ ...nuevo, nombre: e.target.value })} /></div>
            <div className="campo"><label>Correo</label><input type="email" required value={nuevo.email} onChange={(e) => setNuevo({ ...nuevo, email: e.target.value })} /></div>
            <div className="campo">
              <label>Rol</label>
              <select value={nuevo.rol} onChange={(e) => setNuevo({ ...nuevo, rol: e.target.value })}>
                {Object.entries(ROLES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div className="campo" style={{ flex: '0 0 auto' }}><button className="primario">Invitar</button></div>
          </div>
          {msg && <div className={`alerta ${msg.t}`}>{msg.m}</div>}
        </form>
      )}

      {pendientes.length > 0 && (
        <>
          <h2>Invitaciones pendientes</h2>
          <div className="tabla-wrap">
            <table>
              <thead><tr><th>Nombre</th><th>Correo</th><th>Rol</th><th>Invitado</th></tr></thead>
              <tbody>{pendientes.map((i) => <tr key={i.email}><td>{i.nombre}</td><td>{i.email}</td><td>{ROLES[i.rol]}</td><td>{fechaCL(i.created_at)}</td></tr>)}</tbody>
            </table>
          </div>
        </>
      )}

      <h2>Usuarios activos</h2>
      <div className="tabla-wrap">
        <table>
          <thead><tr><th>Nombre</th><th>Correo</th><th>Rol</th><th>Estado</th></tr></thead>
          <tbody>
            {perfiles.filas.filter((p) => p.email).map((p) => (
              <tr key={p.user_id}>
                <td>{p.nombre}</td>
                <td>{p.email}</td>
                <td>
                  {esAdmin ? (
                    <select value={p.rol} onChange={(e) => actualizar(p, { rol: e.target.value })} style={{ width: 'auto' }}>
                      {Object.entries(ROLES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                  ) : ROLES[p.rol]}
                </td>
                <td>
                  {esAdmin ? (
                    <label className="check"><input type="checkbox" checked={p.activo} onChange={(e) => actualizar(p, { activo: e.target.checked })} /> {p.activo ? 'Activo' : 'Sin acceso'}</label>
                  ) : p.activo ? 'Activo' : 'Sin acceso'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
