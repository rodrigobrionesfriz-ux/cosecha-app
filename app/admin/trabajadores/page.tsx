'use client';
import { useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { cargarTabla, errorAmigable, useTabla } from '@/lib/datos';
import { formatearRut, normalizarRut, rutValido, uuid } from '@/lib/util';

const ESTADOS: Record<string, [string, string]> = { A: ['Activo', 'ok'], B: ['Bloqueado', 'err'], I: ['Inactivo', ''] };

export default function Trabajadores() {
  const { perfil } = useAuth();
  const esAdmin = perfil?.rol === 'admin';
  const trab = useTabla<any>('trabajadores', '*', 'apellido_paterno');
  const tarj = useTabla<any>('tarjetas', 'codigo,trabajador_id', 'codigo', (q) => q.eq('estado', 'asignada').eq('tipo', 'W'));
  const contr = useTabla<any>('contratistas', 'id,nombre', 'nombre');
  const [filtro, setFiltro] = useState('');
  const [fEstado, setFEstado] = useState('');
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [edit, setEdit] = useState<any | null>(null);
  const [msg, setMsg] = useState('');
  const [imp, setImp] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState('');

  const credDe = useMemo(() => {
    const m = new Map<string, string>();
    tarj.filas.forEach((t) => m.set(t.trabajador_id, t.codigo));
    return m;
  }, [tarj.filas]);

  const visibles = useMemo(() => {
    const f = filtro.toLowerCase();
    return trab.filas.filter((t) =>
      (!fEstado || t.estado === fEstado || (fEstado === 'sin' && !credDe.has(t.id))) &&
      (!f || `${t.rut} ${t.nombres} ${t.apellido_paterno ?? ''} ${t.apellido_materno ?? ''}`.toLowerCase().includes(f) || (credDe.get(t.id) || '').toLowerCase().includes(f))
    );
  }, [trab.filas, filtro, fEstado, credDe]);

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    const rut = edit.extranjero ? edit.rut.trim().toUpperCase() : normalizarRut(edit.rut);
    if (!edit.extranjero && !rutValido(rut)) { setMsg('RUT inválido'); return; }
    const d = {
      empresa_id: perfil!.empresa_id, rut, extranjero: !!edit.extranjero,
      nombres: edit.nombres.trim(), apellido_paterno: edit.apellido_paterno?.trim() || null,
      apellido_materno: edit.apellido_materno?.trim() || null, contratista_id: edit.contratista_id || null,
      estado: edit.estado || 'A',
    };
    const { error } = edit.id ? await supabase.from('trabajadores').update(d).eq('id', edit.id) : await supabase.from('trabajadores').insert(d);
    if (error) { setMsg(errorAmigable(error.message)); return; }
    setEdit(null); trab.recargar();
  }

  async function cambiarEstado(ids: string[], estado: string) {
    await supabase.from('trabajadores').update({ estado }).in('id', ids);
    setSel(new Set()); trab.recargar();
  }

  async function importar() {
    // Formato por línea: RUT;Nombres;Apellido paterno;Apellido materno;Contratista
    const lineas = (imp || '').split('\n').map((l) => l.trim()).filter(Boolean);
    const filas: any[] = []; const malos: string[] = [];
    for (const l of lineas) {
      const p = l.split(/[;\t]/).map((x) => x.trim());
      if (/rut/i.test(p[0])) continue; // encabezado
      const rut = normalizarRut(p[0]);
      if (!rutValido(rut) || !p[1]) { malos.push(l); continue; }
      const c = contr.filas.find((x) => x.nombre.toLowerCase() === (p[4] || '').toLowerCase());
      filas.push({ empresa_id: perfil!.empresa_id, rut, nombres: p[1], apellido_paterno: p[2] || null, apellido_materno: p[3] || null, contratista_id: c?.id || null });
    }
    if (!filas.length) { alert('No hay filas válidas.'); return; }
    const { error } = await supabase.from('trabajadores').upsert(filas, { onConflict: 'empresa_id,rut' });
    if (error) { alert(errorAmigable(error.message)); return; }
    alert(`Cargados ${filas.length} trabajadores.${malos.length ? `\n\nOmitidas ${malos.length} filas con RUT inválido o sin nombre:\n${malos.slice(0, 10).join('\n')}` : ''}`);
    setImp(null); trab.recargar();
  }

  /** Crea credenciales con nombre para los seleccionados que no tienen, y abre la impresión */
  async function credencialesConNombre() {
    const elegidos = trab.filas.filter((t) => sel.has(t.id) && t.estado !== 'B');
    const sinCred = elegidos.filter((t) => !credDe.has(t.id));
    try {
      if (sinCred.length) {
        setOcupado(`Generando ${sinCred.length} credenciales…`);
        const { data: lote, error } = await supabase.rpc('generar_tarjetas', { p_tipo: 'W', p_cantidad: sinCred.length, p_descripcion: 'Credenciales con nombre' });
        if (error) throw error;
        const nuevas = await cargarTabla<any>('tarjetas', 'codigo', (q) => q.eq('lote_id', lote), 'codigo');
        for (let i = 0; i < sinCred.length; i++) {
          setOcupado(`Asignando ${i + 1} de ${sinCred.length}…`);
          const t = sinCred[i];
          const { error: e2 } = await supabase.rpc('asignar_credencial', { p_id: uuid(), p_codigo: nuevas[i].codigo, p_rut: t.rut, p_extranjero: t.extranjero });
          if (e2) throw e2;
        }
      }
      const asignadas = await cargarTabla<any>('tarjetas', 'codigo', (q) => q.in('trabajador_id', elegidos.map((t) => t.id)).eq('estado', 'asignada'), 'codigo');
      sessionStorage.setItem('imprimir-codigos', JSON.stringify(asignadas.map((a) => a.codigo)));
      window.open('/admin/tarjetas/imprimir/?sesion=1', '_blank');
      setSel(new Set()); tarj.recargar();
    } catch (e: any) {
      alert(errorAmigable(e.message));
    }
    setOcupado('');
  }

  async function liberar(t: any) {
    const cod = credDe.get(t.id);
    if (!cod || !confirm(`¿Liberar la credencial ${cod} de ${t.nombres}?`)) return;
    await supabase.rpc('liberar_credencial', { p_codigo: cod });
    tarj.recargar();
  }

  const todos = visibles.length > 0 && visibles.every((t) => sel.has(t.id));
  const toggle = (id: string) => { const s = new Set(sel); s.has(id) ? s.delete(id) : s.add(id); setSel(s); };

  return (
    <div>
      <div className="encabezado">
        <h1>Trabajadores <span className="muted">({trab.filas.length})</span></h1>
        {esAdmin && (
          <div className="acciones">
            <button onClick={() => setImp(imp === null ? '' : null)}>Cargar desde Excel</button>
            <button className="primario" onClick={() => { setEdit({ rut: '', nombres: '', estado: 'A' }); setMsg(''); }}>+ Trabajador</button>
          </div>
        )}
      </div>

      {imp !== null && (
        <div className="tarjeta">
          <h3 style={{ marginTop: 0 }}>Carga masiva</h3>
          <p className="muted" style={{ marginTop: 0 }}>
            Copia desde Excel las columnas <b>RUT · Nombres · Apellido paterno · Apellido materno · Contratista</b> y pégalas aquí.
            Si el RUT ya existe, se actualizan sus datos.
          </p>
          <textarea rows={8} value={imp} onChange={(e) => setImp(e.target.value)} placeholder={'12.345.678-5\tJuan\tPérez\tSoto\tContratista Uno'} />
          <div className="acciones" style={{ marginTop: '.6rem' }}>
            <button className="primario" onClick={importar}>Cargar</button>
            <button onClick={() => setImp(null)}>Cancelar</button>
          </div>
        </div>
      )}

      {edit && (
        <form className="tarjeta" onSubmit={guardar}>
          <div className="fila">
            <div className="campo" style={{ flex: '0 1 170px' }}>
              <label>{edit.extranjero ? 'Documento' : 'RUT'} *</label>
              <input required value={edit.rut} onChange={(e) => setEdit({ ...edit, rut: e.target.value })} disabled={!!edit.id} />
            </div>
            <div className="campo"><label>Nombres *</label><input required value={edit.nombres} onChange={(e) => setEdit({ ...edit, nombres: e.target.value })} /></div>
            <div className="campo"><label>Apellido paterno</label><input value={edit.apellido_paterno ?? ''} onChange={(e) => setEdit({ ...edit, apellido_paterno: e.target.value })} /></div>
            <div className="campo"><label>Apellido materno</label><input value={edit.apellido_materno ?? ''} onChange={(e) => setEdit({ ...edit, apellido_materno: e.target.value })} /></div>
          </div>
          <div className="fila">
            <div className="campo">
              <label>Contratista</label>
              <select value={edit.contratista_id ?? ''} onChange={(e) => setEdit({ ...edit, contratista_id: e.target.value })}>
                <option value="">Directo (sin contratista)</option>
                {contr.filas.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
              </select>
            </div>
            <div className="campo">
              <label>Estado</label>
              <select value={edit.estado} onChange={(e) => setEdit({ ...edit, estado: e.target.value })}>
                <option value="A">Activo</option><option value="B">Bloqueado</option><option value="I">Inactivo</option>
              </select>
            </div>
            {!edit.id && (
              <label className="check" style={{ flex: '0 1 auto', marginBottom: '1rem' }}>
                <input type="checkbox" checked={!!edit.extranjero} onChange={(e) => setEdit({ ...edit, extranjero: e.target.checked })} /> Extranjero sin RUT
              </label>
            )}
          </div>
          {msg && <div className="alerta error">{msg}</div>}
          <div className="acciones"><button className="primario">Guardar</button><button type="button" onClick={() => setEdit(null)}>Cancelar</button></div>
        </form>
      )}

      <div className="fila" style={{ marginBottom: '.8rem' }}>
        <input placeholder="Buscar por RUT, nombre o credencial…" value={filtro} onChange={(e) => setFiltro(e.target.value)} />
        <select value={fEstado} onChange={(e) => setFEstado(e.target.value)} style={{ flex: '0 1 200px' }}>
          <option value="">Todos</option><option value="A">Activos</option><option value="B">Bloqueados</option>
          <option value="I">Inactivos</option><option value="sin">Sin credencial</option>
        </select>
      </div>

      {esAdmin && sel.size > 0 && (
        <div className="alerta info acciones">
          <b>{sel.size} seleccionados</b>
          <button className="primario chico" onClick={credencialesConNombre} disabled={!!ocupado}>🪪 Credenciales con nombre</button>
          <button className="chico" onClick={() => cambiarEstado([...sel], 'B')}>Bloquear</button>
          <button className="chico" onClick={() => cambiarEstado([...sel], 'A')}>Activar</button>
          <button className="chico" onClick={() => cambiarEstado([...sel], 'I')}>Inactivar</button>
          {ocupado && <span>{ocupado}</span>}
        </div>
      )}

      <div className="tabla-wrap">
        <table>
          <thead>
            <tr>
              {esAdmin && <th style={{ width: 30 }}><input type="checkbox" checked={todos} onChange={() => setSel(todos ? new Set() : new Set(visibles.map((t) => t.id)))} /></th>}
              <th>RUT</th><th>Nombre</th><th>Contratista</th><th>Credencial</th><th>Estado</th>{esAdmin && <th></th>}
            </tr>
          </thead>
          <tbody>
            {trab.cargando && <tr><td colSpan={7} className="muted">Cargando…</td></tr>}
            {!trab.cargando && !visibles.length && <tr><td colSpan={7} className="muted">Sin trabajadores. Agrégalos uno a uno, cárgalos desde Excel, o se crean solos al asignar credenciales en terreno.</td></tr>}
            {visibles.map((t) => (
              <tr key={t.id}>
                {esAdmin && <td><input type="checkbox" checked={sel.has(t.id)} onChange={() => toggle(t.id)} /></td>}
                <td className="mono">{t.extranjero ? t.rut : formatearRut(t.rut)}</td>
                <td>{t.nombres} {t.apellido_paterno} {t.apellido_materno}</td>
                <td>{contr.filas.find((c) => c.id === t.contratista_id)?.nombre ?? <span className="muted">Directo</span>}</td>
                <td className="mono">{credDe.get(t.id) ?? <span className="muted">—</span>}</td>
                <td><span className={`badge ${ESTADOS[t.estado][1]}`}>{ESTADOS[t.estado][0]}</span></td>
                {esAdmin && (
                  <td className="acciones" style={{ justifyContent: 'flex-end' }}>
                    <button className="chico" onClick={() => { setEdit({ ...t }); setMsg(''); }}>Editar</button>
                    {credDe.has(t.id) && <button className="chico" onClick={() => liberar(t)}>Liberar credencial</button>}
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
