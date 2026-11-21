'use client';
import { useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { errorAmigable, useTabla } from '@/lib/datos';

export type Campo = {
  k: string;
  t: string;
  tipo?: 'text' | 'number' | 'bool' | 'select' | 'lista'; // lista = texto separado por comas ↔ arreglo
  opciones?: { v: string; t: string }[];
  req?: boolean;
  ancho?: number;
  def?: any;
  inline?: boolean; // bool editable directo en la tabla con interruptor
};

type Props = {
  tabla: string;
  titulo: string;
  campos: Campo[];
  orden?: string;
  ayuda?: string;
  onGuardado?: () => void;
  calculadas?: { t: string; fn: (fila: any) => string }[]; // columnas de solo lectura derivadas de la fila
};

/** Mantenedor genérico: lista + formulario de alta/edición */
export default function Crud({ tabla, titulo, campos, orden = 'nombre', ayuda, onGuardado, calculadas = [] }: Props) {
  const { perfil } = useAuth();
  const { filas, cargando, error, recargar, setFilas } = useTabla<any>(tabla, '*', orden);
  const [edit, setEdit] = useState<any | null>(null);
  const [msg, setMsg] = useState('');
  const [filtro, setFiltro] = useState('');
  const esAdmin = perfil?.rol === 'admin';

  const nuevo = () => {
    const o: any = {};
    campos.forEach((c) => (o[c.k] = c.def ?? (c.tipo === 'bool' ? true : '')));
    if (campos.every((c) => c.k !== 'activo') && filas[0] && 'activo' in filas[0]) o.activo = true;
    setEdit(o);
    setMsg('');
  };

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    const datos: any = { empresa_id: perfil!.empresa_id };
    for (const c of campos) {
      let v = edit[c.k];
      if (c.tipo === 'number') v = v === '' || v === null || v === undefined ? null : Number(v);
      if (c.tipo === 'select' && v === '') v = null;
      if (c.tipo === 'lista') v = (Array.isArray(v) ? v : String(v ?? '').split(',')).map((x: string) => x.trim()).filter(Boolean);
      if (c.tipo === 'text' || !c.tipo) v = typeof v === 'string' ? v.trim() || null : v;
      datos[c.k] = v;
    }
    if ('activo' in edit && !campos.some((c) => c.k === 'activo')) datos.activo = edit.activo;
    const q = edit.id ? supabase.from(tabla).update(datos).eq('id', edit.id) : supabase.from(tabla).insert(datos);
    const { error } = await q;
    if (error) { setMsg(errorAmigable(error.message)); return; }
    setEdit(null);
    recargar();
    onGuardado?.();
  }

  async function alternar(f: any, c: Campo, valor: boolean) {
    setFilas(filas.map((x) => (x.id === f.id ? { ...x, [c.k]: valor } : x)));
    const { error } = await supabase.from(tabla).update({ [c.k]: valor }).eq('id', f.id);
    if (error) { alert(errorAmigable(error.message)); recargar(); return; }
    onGuardado?.();
  }

  async function borrar(f: any) {
    if (!confirm(`¿Eliminar "${f.nombre ?? f.id}"?`)) return;
    const { error } = await supabase.from(tabla).delete().eq('id', f.id);
    if (error) alert(errorAmigable(error.message));
    recargar();
  }

  const mostrar = (c: Campo, v: any) => {
    if (c.tipo === 'bool') return v ? '✔' : '—';
    if (c.tipo === 'select') return c.opciones?.find((o) => o.v === v)?.t ?? '—';
    if (c.tipo === 'lista') return Array.isArray(v) && v.length ? v.join(', ') : '—';
    return v ?? '—';
  };

  const visibles = useMemo(() => {
    const f = filtro.toLowerCase();
    if (!f) return filas;
    return filas.filter((r) => campos.some((c) => String(mostrar(c, r[c.k]) ?? '').toLowerCase().includes(f)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filas, filtro]);

  return (
    <div>
      <div className="encabezado">
        <h2 style={{ margin: 0 }}>{titulo} <span className="muted">({filas.length})</span></h2>
        <div className="acciones">
          {filas.length > 8 && <input placeholder="Buscar…" value={filtro} onChange={(e) => setFiltro(e.target.value)} style={{ width: 180 }} />}
          {esAdmin && <button className="primario" onClick={nuevo}>+ Agregar</button>}
        </div>
      </div>
      {ayuda && <p className="muted" style={{ marginTop: 0 }}>{ayuda}</p>}
      {error && <div className="alerta error">{error}</div>}

      {edit && (
        <form className="tarjeta" onSubmit={guardar}>
          <div className="fila">
            {campos.map((c) => (
              <div className="campo" key={c.k} style={c.ancho ? { flex: `0 1 ${c.ancho}px` } : undefined}>
                {c.tipo === 'bool' ? (
                  <label className="check" style={{ marginTop: '1.4rem' }}>
                    <input type="checkbox" checked={!!edit[c.k]} onChange={(e) => setEdit({ ...edit, [c.k]: e.target.checked })} /> {c.t}
                  </label>
                ) : (
                  <>
                    <label>{c.t}{c.req && ' *'}</label>
                    {c.tipo === 'select' ? (
                      <select required={c.req} value={edit[c.k] ?? ''} onChange={(e) => setEdit({ ...edit, [c.k]: e.target.value })}>
                        <option value="">—</option>
                        {c.opciones?.map((o) => <option key={o.v} value={o.v}>{o.t}</option>)}
                      </select>
                    ) : (
                      <input type={c.tipo === 'number' ? 'number' : 'text'} step="any" required={c.req}
                        value={Array.isArray(edit[c.k]) ? edit[c.k].join(', ') : edit[c.k] ?? ''} onChange={(e) => setEdit({ ...edit, [c.k]: e.target.value })} />
                    )}
                  </>
                )}
              </div>
            ))}
            {'activo' in edit && !campos.some((c) => c.k === 'activo') && (
              <div className="campo" style={{ flex: '0 1 100px' }}>
                <label className="check" style={{ marginTop: '1.4rem' }}>
                  <input type="checkbox" checked={!!edit.activo} onChange={(e) => setEdit({ ...edit, activo: e.target.checked })} /> Activo
                </label>
              </div>
            )}
          </div>
          {calculadas.length > 0 && (
            <p className="muted" style={{ margin: '.25rem 0 .5rem' }}>
              {calculadas.map((c) => `${c.t}: ${c.fn(edit)}`).join(' · ')}
            </p>
          )}
          {msg && <div className="alerta error">{msg}</div>}
          <div className="acciones">
            <button className="primario">Guardar</button>
            <button type="button" onClick={() => setEdit(null)}>Cancelar</button>
          </div>
        </form>
      )}

      <div className="tabla-wrap">
        <table>
          <thead>
            <tr>
              {campos.map((c) => <th key={c.k} className={c.tipo === 'number' ? 'n' : ''}>{c.t}</th>)}
              {calculadas.map((c) => <th key={c.t} className="n">{c.t}</th>)}
              {filas[0] && 'activo' in filas[0] && !campos.some((c) => c.k === 'activo') && <th>Estado</th>}
              {esAdmin && <th></th>}
            </tr>
          </thead>
          <tbody>
            {cargando && <tr><td colSpan={99} className="muted">Cargando…</td></tr>}
            {!cargando && !visibles.length && <tr><td colSpan={99} className="muted">Sin registros todavía.</td></tr>}
            {visibles.map((f) => (
              <tr key={f.id ?? f.huerto_id}>
                {campos.map((c) => (
                  <td key={c.k} className={c.tipo === 'number' ? 'n' : ''}>
                    {c.tipo === 'bool' && c.inline && esAdmin ? (
                      <label className={`interruptor ${f[c.k] ? 'on' : ''}`} style={{ padding: 0 }}>
                        <input type="checkbox" checked={!!f[c.k]} onChange={(e) => alternar(f, c, e.target.checked)} />
                        <span className="pista" aria-hidden />
                        <span className="txt muted" style={{ fontSize: '.82rem' }}>{f[c.k] ? 'Sí' : 'No'}</span>
                      </label>
                    ) : mostrar(c, f[c.k])}
                  </td>
                ))}
                {calculadas.map((c) => <td key={c.t} className="n">{c.fn(f)}</td>)}
                {'activo' in f && !campos.some((c) => c.k === 'activo') && (
                  <td>{f.activo ? <span className="badge ok">Activo</span> : <span className="badge">Inactivo</span>}</td>
                )}
                {esAdmin && (
                  <td className="acciones" style={{ justifyContent: 'flex-end' }}>
                    <button className="chico" onClick={() => { setEdit({ ...f }); setMsg(''); }}>Editar</button>
                    <button className="chico peligro" onClick={() => borrar(f)}>Eliminar</button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
