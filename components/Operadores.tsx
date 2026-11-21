'use client';
import { useState } from 'react';
import { supabase } from '@/lib/supabase';
import { errorAmigable, useTabla } from '@/lib/datos';
import { useAuth } from '@/lib/auth';

const ROL: Record<string, string> = { jefe: 'Jefe de cuadrilla', acopio: 'Operador de acopio' };

/** Jefes de cuadrilla y operadores de acopio sin correo: entran en los equipos con nombre y PIN */
export default function Operadores({ esAdmin }: { esAdmin: boolean }) {
  const { perfil } = useAuth();
  const ops = useTabla<any>('operadores', 'id,nombre,rut,rol,activo,pin_hash,cuadrilla_id', 'nombre');
  const cuadrillas = useTabla<any>('cuadrillas', 'id,nombre', 'nombre');
  const [nuevo, setNuevo] = useState({ nombre: '', rol: 'jefe', pin: '', cuadrilla_id: '' });
  const [msg, setMsg] = useState<{ t: string; m: string } | null>(null);

  async function crear(e: React.FormEvent) {
    e.preventDefault();
    if (!/^\d{4}$/.test(nuevo.pin)) { setMsg({ t: 'error', m: 'El PIN debe tener 4 dígitos.' }); return; }
    const { data, error } = await supabase.from('operadores')
      .insert({ empresa_id: perfil!.empresa_id, nombre: nuevo.nombre.trim(), rol: nuevo.rol, cuadrilla_id: nuevo.cuadrilla_id || null }).select('id').single();
    if (error) { setMsg({ t: 'error', m: errorAmigable(error.message) }); return; }
    const r = await supabase.rpc('fijar_pin_operador', { p_id: data.id, p_pin: nuevo.pin });
    if (r.error) { setMsg({ t: 'error', m: r.error.message }); return; }
    setMsg({ t: 'ok', m: `${nuevo.nombre} creado. Para verlo en los teléfonos, el equipo debe sincronizar.` });
    setNuevo({ nombre: '', rol: nuevo.rol, pin: '', cuadrilla_id: '' });
    ops.recargar();
  }

  async function cambiar(o: any, c: any) {
    const { error } = await supabase.from('operadores').update(c).eq('id', o.id);
    if (error) alert(errorAmigable(error.message));
    ops.recargar();
  }

  async function nuevoPin(o: any) {
    const pin = prompt(`Nuevo PIN de 4 dígitos para ${o.nombre}:`);
    if (pin == null) return;
    const { error } = await supabase.rpc('fijar_pin_operador', { p_id: o.id, p_pin: pin.trim() });
    if (error) return alert(error.message);
    alert('PIN actualizado. El equipo lo recibe al sincronizar.');
    ops.recargar();
  }

  async function renombrar(o: any) {
    const n = prompt('Nombre:', o.nombre);
    if (n && n.trim() && n.trim() !== o.nombre) cambiar(o, { nombre: n.trim() });
  }

  return (
    <section className="tarjeta">
      <h3 style={{ marginTop: 0 }}>Jefes de cuadrilla y operadores de acopio</h3>
      <p className="muted" style={{ marginTop: 0 }}>
        No usan correo: en el teléfono del equipo eligen su nombre y confirman con su PIN de 4 dígitos.
        Deshabilitar a alguien lo saca de la lista en la próxima sincronización.
      </p>
      {esAdmin && (
        <form onSubmit={crear} className="fila">
          <div className="campo"><label>Nombre</label><input required value={nuevo.nombre} onChange={(e) => setNuevo({ ...nuevo, nombre: e.target.value })} /></div>
          <div className="campo" style={{ flex: '0 1 190px' }}>
            <label>Rol</label>
            <select value={nuevo.rol} onChange={(e) => setNuevo({ ...nuevo, rol: e.target.value })}>
              <option value="jefe">Jefe de cuadrilla</option>
              <option value="acopio">Operador de acopio</option>
            </select>
          </div>
          {nuevo.rol === 'jefe' && cuadrillas.filas.length > 0 && (
            <div className="campo" style={{ flex: '0 1 180px' }}>
              <label>Cuadrilla</label>
              <select value={nuevo.cuadrilla_id} onChange={(e) => setNuevo({ ...nuevo, cuadrilla_id: e.target.value })}>
                <option value="">—</option>
                {cuadrillas.filas.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
              </select>
            </div>
          )}
          <div className="campo" style={{ flex: '0 1 110px' }}><label>PIN</label><input required inputMode="numeric" maxLength={4} pattern="\d{4}" value={nuevo.pin} onChange={(e) => setNuevo({ ...nuevo, pin: e.target.value.replace(/\D/g, '') })} className="mono" /></div>
          <div className="campo" style={{ flex: '0 0 auto' }}><label>&nbsp;</label><button className="primario">Agregar</button></div>
        </form>
      )}
      {msg && <div className={`alerta ${msg.t}`}>{msg.m}</div>}
      <div className="tabla-wrap">
        <table>
          <thead><tr><th>Nombre</th><th>Rol</th><th>Cuadrilla</th><th>PIN</th><th>Estado</th><th></th></tr></thead>
          <tbody>
            {!ops.filas.length && !ops.cargando && <tr><td colSpan={6} className="muted">Aún no hay jefes ni operadores.</td></tr>}
            {ops.filas.map((o) => (
              <tr key={o.id} style={o.activo ? undefined : { opacity: .55 }}>
                <td>{o.nombre}</td>
                <td>{ROL[o.rol]}</td>
                <td>{cuadrillas.filas.find((c) => c.id === o.cuadrilla_id)?.nombre ?? '—'}</td>
                <td>{o.pin_hash ? '••••' : <span className="badge err">Sin PIN</span>}</td>
                <td><span className={`badge ${o.activo ? 'ok' : ''}`}>{o.activo ? 'Habilitado' : 'Deshabilitado'}</span></td>
                <td>
                  {esAdmin && (
                    <div className="acciones" style={{ flexWrap: 'nowrap' }}>
                      <button className="chico" onClick={() => cambiar(o, { activo: !o.activo })}>{o.activo ? 'Deshabilitar' : 'Habilitar'}</button>
                      <button className="chico" onClick={() => nuevoPin(o)}>Cambiar PIN</button>
                      <button className="chico" onClick={() => renombrar(o)}>Renombrar</button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
