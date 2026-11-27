'use client';
import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { cargarTabla, errorAmigable } from '@/lib/datos';
import { supabase } from '@/lib/supabase';
import { formatearRut, rutValido } from '@/lib/util';

/** Ficha del packing: los mismos datos que la ficha de empresa */
const FICHA: { k: string; t: string; full?: boolean }[] = [
  { k: 'nombre', t: 'Razón social *', full: true },
  { k: 'nombre_corto', t: 'Nombre corto' },
  { k: 'rut', t: 'RUT' },
  { k: 'giro', t: 'Giro', full: true },
  { k: 'direccion', t: 'Dirección (casa matriz)', full: true },
  { k: 'comuna', t: 'Comuna' },
  { k: 'ciudad', t: 'Ciudad' },
  { k: 'telefono', t: 'Teléfono' },
  { k: 'email', t: 'Correo' },
  { k: 'representante', t: 'Representante legal' },
];
const PLANTA: { k: string; t: string }[] = [
  { k: 'nombre', t: 'Nombre de la planta *' },
  { k: 'direccion', t: 'Dirección' },
  { k: 'comuna', t: 'Comuna' },
  { k: 'ciudad', t: 'Ciudad' },
  { k: 'contacto', t: 'Contacto' },
  { k: 'telefono', t: 'Teléfono' },
];

export default function Destinos() {
  const { perfil } = useAuth();
  const esAdmin = perfil?.rol === 'admin';
  const [packings, setPackings] = useState<any[]>([]);
  const [plantas, setPlantas] = useState<any[]>([]);
  const [sel, setSel] = useState<any | null>(null);       // ficha en edición (id vacío = nuevo)
  const [planta, setPlanta] = useState<any | null>(null); // planta en edición
  const [verInactivos, setVerInactivos] = useState(false);
  const [msg, setMsg] = useState<{ t: string; m: string } | null>(null);

  async function cargar() {
    const [p, pl] = await Promise.all([cargarTabla<any>('packings', '*', undefined, 'nombre'), cargarTabla<any>('packing_plantas', '*', undefined, 'nombre')]);
    setPackings(p); setPlantas(pl);
    if (sel?.id) setSel(p.find((x) => x.id === sel.id) || null);
  }
  useEffect(() => { cargar(); }, []); // eslint-disable-line

  async function guardarFicha(ev: React.FormEvent) {
    ev.preventDefault();
    const rut = (sel.rut || '').replace(/[^0-9kK]/g, '').toUpperCase();
    if (rut && !rutValido(rut)) { setMsg({ t: 'error', m: 'El RUT no es válido.' }); return; }
    const datos: any = { empresa_id: perfil!.empresa_id };
    for (const c of FICHA) datos[c.k] = (sel[c.k] ?? '').toString().trim() || null;
    datos.rut = rut || null;
    const q = sel.id ? supabase.from('packings').update(datos).eq('id', sel.id).select().single() : supabase.from('packings').insert(datos).select().single();
    const { data, error } = await q;
    if (error) { setMsg({ t: 'error', m: /packings_rut_uq/.test(error.message) ? 'Ya existe un packing con ese RUT.' : errorAmigable(error.message) }); return; }
    setMsg({ t: 'ok', m: 'Ficha guardada.' });
    setSel(data);
    cargar();
  }

  async function alternarPacking(p: any) {
    const { error } = await supabase.from('packings').update({ activo: !p.activo }).eq('id', p.id);
    if (error) alert(errorAmigable(error.message));
    cargar();
  }

  async function guardarPlanta(ev: React.FormEvent) {
    ev.preventDefault();
    if (!planta.nombre?.trim()) return;
    const datos: any = { empresa_id: perfil!.empresa_id, packing_id: sel.id };
    for (const c of PLANTA) datos[c.k] = (planta[c.k] ?? '').toString().trim() || null;
    const q = planta.id ? supabase.from('packing_plantas').update(datos).eq('id', planta.id) : supabase.from('packing_plantas').insert(datos);
    const { error } = await q;
    if (error) { alert(errorAmigable(error.message)); return; }
    setPlanta(null);
    cargar();
  }

  async function alternarPlanta(p: any) {
    const { error } = await supabase.from('packing_plantas').update({ activo: !p.activo }).eq('id', p.id);
    if (error) alert(errorAmigable(error.message));
    cargar();
  }

  const lista = packings.filter((p) => verInactivos || p.activo);
  const plantasSel = sel?.id ? plantas.filter((x) => x.packing_id === sel.id) : [];

  return (
    <div>
      <div className="encabezado">
        <h1>Destinos (packing)</h1>
        {esAdmin && <button className="primario" onClick={() => { setSel({ activo: true }); setMsg(null); }}>+ Nuevo packing</button>}
      </div>
      <p className="muted" style={{ marginTop: 0 }}>Packings a los que se despacha, con una o más plantas. En la app de acopio se elige el packing y la planta al abrir el despacho; también se pueden agregar desde ahí y completar la ficha aquí.</p>

      <div className="destinos-grid">
        <section className="tarjeta" style={{ marginBottom: 0 }}>
          <label style={{ display: 'flex', gap: '.4rem', alignItems: 'center', fontSize: '.85rem', marginBottom: '.5rem' }}>
            <input type="checkbox" checked={verInactivos} onChange={(e) => setVerInactivos(e.target.checked)} /> Mostrar inactivos
          </label>
          {!lista.length && <p className="muted">Aún no hay packings.</p>}
          {lista.map((p) => (
            <button key={p.id} className={`destino-item ${sel?.id === p.id ? 'activo' : ''}`} onClick={() => { setSel(p); setPlanta(null); setMsg(null); }}>
              <b>{p.nombre_corto || p.nombre}</b>{!p.activo && <span className="badge" style={{ marginLeft: '.4rem' }}>inactivo</span>}
              <span className="muted">{p.rut ? formatearRut(p.rut) + ' · ' : ''}{plantas.filter((x) => x.packing_id === p.id && x.activo).length} planta(s)</span>
            </button>
          ))}
        </section>

        <div>
          {!sel && <div className="tarjeta muted">Elige un packing para ver su ficha y plantas.</div>}
          {sel && (
            <>
              <form className="tarjeta" onSubmit={guardarFicha}>
                <div className="encabezado" style={{ marginBottom: '.5rem' }}>
                  <h3 style={{ margin: 0 }}>{sel.id ? 'Ficha del packing' : 'Nuevo packing'}</h3>
                  {sel.id && esAdmin && <button type="button" className="chico" onClick={() => alternarPacking(sel)}>{sel.activo ? 'Desactivar' : 'Activar'}</button>}
                </div>
                <div className="fila">
                  {FICHA.map((c) => (
                    <div key={c.k} className="campo" style={c.full ? { flexBasis: '100%' } : undefined}>
                      <label>{c.t}</label>
                      <input required={c.k === 'nombre'} disabled={!esAdmin} value={c.k === 'rut' && sel.rut && !/[.-]/.test(sel.rut) ? formatearRut(sel.rut) : (sel[c.k] ?? '')}
                        onChange={(e) => setSel({ ...sel, [c.k]: e.target.value })} />
                    </div>
                  ))}
                </div>
                {msg && <div className={`alerta ${msg.t}`}>{msg.m}</div>}
                {esAdmin && <button className="primario">Guardar ficha</button>}
              </form>

              {sel.id && (
                <section className="tarjeta">
                  <div className="encabezado" style={{ marginBottom: '.5rem' }}>
                    <h3 style={{ margin: 0 }}>Plantas ({plantasSel.filter((x) => x.activo).length})</h3>
                    {esAdmin && <button className="chico" onClick={() => setPlanta({})}>+ Agregar planta</button>}
                  </div>
                  <div className="tabla-wrap">
                    <table>
                      <thead><tr><th>Planta</th><th>Dirección</th><th>Comuna</th><th>Ciudad</th><th>Contacto</th><th>Teléfono</th><th></th></tr></thead>
                      <tbody>
                        {!plantasSel.length && <tr><td colSpan={7} className="muted">Sin plantas. Agrega al menos una para poder despachar.</td></tr>}
                        {plantasSel.map((p) => (
                          <tr key={p.id} className={p.activo ? '' : 'muted'}>
                            <td><b>{p.nombre}</b>{!p.activo && ' (inactiva)'}</td><td>{p.direccion}</td><td>{p.comuna}</td><td>{p.ciudad}</td><td>{p.contacto}</td><td>{p.telefono}</td>
                            <td>{esAdmin && (
                              <span className="acciones" style={{ flexWrap: 'nowrap' }}>
                                <button className="chico" onClick={() => setPlanta(p)}>Editar</button>
                                <button className="chico" onClick={() => alternarPlanta(p)}>{p.activo ? 'Desactivar' : 'Activar'}</button>
                              </span>
                            )}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {planta && (
                    <form onSubmit={guardarPlanta} style={{ marginTop: '.8rem' }}>
                      <div className="fila">
                        {PLANTA.map((c) => (
                          <div key={c.k} className="campo"><label>{c.t}</label>
                            <input required={c.k === 'nombre'} value={planta[c.k] ?? ''} onChange={(e) => setPlanta({ ...planta, [c.k]: e.target.value })} />
                          </div>
                        ))}
                      </div>
                      <div className="acciones">
                        <button className="primario">{planta.id ? 'Guardar planta' : 'Agregar planta'}</button>
                        <button type="button" onClick={() => setPlanta(null)}>Cancelar</button>
                      </div>
                    </form>
                  )}
                </section>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
