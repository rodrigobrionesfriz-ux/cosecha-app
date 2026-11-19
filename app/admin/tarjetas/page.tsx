'use client';
import { useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { useTabla, errorAmigable } from '@/lib/datos';
import { fechaCL, normalizarCodigo, num } from '@/lib/util';

const TIPOS: Record<string, string> = { W: 'Credencial trabajador', B: 'Etiqueta de caja' };

export default function Tarjetas() {
  const { perfil } = useAuth();
  const lotes = useTabla<any>('lotes_impresion', '*', 'created_at');
  const [tipo, setTipo] = useState<'W' | 'B'>('W');
  const [cantidad, setCantidad] = useState(50);
  const [desc, setDesc] = useState('');
  const [msg, setMsg] = useState<{ t: string; m: string } | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [importar, setImportar] = useState('');
  const [tipoImp, setTipoImp] = useState<'W' | 'B'>('W');
  const [buscar, setBuscar] = useState('');
  const [hallada, setHallada] = useState<any | null | undefined>(undefined);
  const esAdmin = perfil?.rol === 'admin';

  async function generar(e: React.FormEvent) {
    e.preventDefault();
    setOcupado(true); setMsg(null);
    const { data, error } = await supabase.rpc('generar_tarjetas', { p_tipo: tipo, p_cantidad: cantidad, p_descripcion: desc || null });
    setOcupado(false);
    if (error) { setMsg({ t: 'error', m: errorAmigable(error.message) }); return; }
    setMsg({ t: 'ok', m: `Se generaron ${cantidad} códigos.` });
    setDesc('');
    lotes.recargar();
    window.open(`/admin/tarjetas/imprimir/?lote=${data}`, '_blank');
  }

  async function hacerImportacion() {
    const codigos = importar.split(/[\s,;]+/).map(normalizarCodigo).filter(Boolean);
    if (!codigos.length) return;
    setOcupado(true);
    const { data, error } = await supabase.rpc('importar_tarjetas', { p_tipo: tipoImp, p_codigos: codigos, p_descripcion: 'Importación de códigos existentes' });
    setOcupado(false);
    if (error) { alert(errorAmigable(error.message)); return; }
    alert(`Importados ${data} de ${codigos.length} códigos (los repetidos se omiten).`);
    setImportar('');
    lotes.recargar();
  }

  async function consultar(e: React.FormEvent) {
    e.preventDefault();
    const { data } = await supabase.from('tarjetas')
      .select('*, trabajador:trabajadores(rut,nombres,apellido_paterno)')
      .eq('codigo', normalizarCodigo(buscar)).maybeSingle();
    setHallada(data);
  }

  async function liberar() {
    if (!confirm('¿Liberar esta credencial? Quedará disponible para otro trabajador.')) return;
    await supabase.rpc('liberar_credencial', { p_codigo: hallada.codigo });
    consultar(new Event('submit') as any);
  }
  async function anular() {
    if (!confirm('¿Anular esta tarjeta? No podrá volver a usarse (por ejemplo, si se perdió).')) return;
    await supabase.from('tarjetas').update({ estado: 'anulada', trabajador_id: null }).eq('id', hallada.id);
    consultar(new Event('submit') as any);
  }

  const ordenados = [...lotes.filas].reverse();

  return (
    <div>
      <h1>Tarjetas QR</h1>
      <p className="muted" style={{ marginTop: -8 }}>
        Los códigos siguen el formato <span className="mono">BC-W-0100000001</span> (credencial) y <span className="mono">BC-B-0100000001</span> (caja).
        Los dos primeros dígitos son el código de la empresa. Para credenciales con el nombre impreso, selecciona trabajadores en <a href="/admin/trabajadores/">Trabajadores</a>.
      </p>

      {esAdmin && (
        <div className="fila" style={{ alignItems: 'stretch' }}>
          <form className="tarjeta" onSubmit={generar}>
            <h3 style={{ marginTop: 0 }}>Generar códigos nuevos</h3>
            <div className="campo">
              <label>Tipo</label>
              <select value={tipo} onChange={(e) => setTipo(e.target.value as any)}>
                <option value="W">Credenciales de trabajador (en blanco)</option>
                <option value="B">Etiquetas de caja</option>
              </select>
            </div>
            <div className="fila">
              <div className="campo">
                <label>Cantidad</label>
                <input type="number" min={1} max={5000} value={cantidad} onChange={(e) => setCantidad(+e.target.value)} />
              </div>
              <div className="campo">
                <label>Descripción (opcional)</label>
                <input value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Temporada 2026-27" />
              </div>
            </div>
            {msg && <div className={`alerta ${msg.t}`}>{msg.m}</div>}
            <button className="primario" disabled={ocupado}>Generar e imprimir</button>
          </form>

          <div className="tarjeta">
            <h3 style={{ marginTop: 0 }}>Registrar códigos ya impresos</h3>
            <p className="muted" style={{ marginTop: 0 }}>Pega los códigos de credenciales o etiquetas que ya existen (uno por línea) para que el sistema los reconozca.</p>
            <div className="campo">
              <select value={tipoImp} onChange={(e) => setTipoImp(e.target.value as any)}>
                <option value="W">Credenciales</option>
                <option value="B">Etiquetas de caja</option>
              </select>
            </div>
            <textarea rows={4} value={importar} onChange={(e) => setImportar(e.target.value)} placeholder={'BC-W-000000000000000123\nBC-W-000000000000000124'} />
            <div style={{ marginTop: '.6rem' }}><button onClick={hacerImportacion} disabled={ocupado || !importar.trim()}>Importar</button></div>
          </div>
        </div>
      )}

      <h2>Consultar una tarjeta</h2>
      <form className="fila" onSubmit={consultar} style={{ maxWidth: 520 }}>
        <input value={buscar} onChange={(e) => setBuscar(e.target.value)} placeholder="BC-W-0100000001" className="mono" />
        <button style={{ flex: '0 0 auto' }}>Buscar</button>
      </form>
      {hallada === null && <div className="alerta aviso">No existe ese código.</div>}
      {hallada && (
        <div className="tarjeta" style={{ maxWidth: 520, marginTop: '.6rem' }}>
          <div className="mono">{hallada.codigo}</div>
          <div>{TIPOS[hallada.tipo]} · <span className={`badge ${hallada.estado === 'asignada' ? 'ok' : hallada.estado === 'anulada' ? 'err' : ''}`}>{hallada.estado}</span></div>
          {hallada.trabajador && <div>Asignada a <b>{hallada.trabajador.nombres} {hallada.trabajador.apellido_paterno}</b> ({hallada.trabajador.rut})</div>}
          {esAdmin && (
            <div className="acciones" style={{ marginTop: '.6rem' }}>
              {hallada.estado === 'asignada' && <button className="chico" onClick={liberar}>Liberar</button>}
              {hallada.estado !== 'anulada' && <button className="chico peligro" onClick={anular}>Anular (perdida)</button>}
              <a className="btn chico" target="_blank" href={`/admin/tarjetas/imprimir/?codigos=${encodeURIComponent(hallada.codigo)}`}>Reimprimir</a>
            </div>
          )}
        </div>
      )}

      <h2>Lotes generados</h2>
      <div className="tabla-wrap">
        <table>
          <thead><tr><th>Fecha</th><th>Tipo</th><th>Descripción</th><th className="n">Cantidad</th><th>Rango</th><th></th></tr></thead>
          <tbody>
            {!ordenados.length && <tr><td colSpan={6} className="muted">Aún no se generan códigos.</td></tr>}
            {ordenados.map((l) => (
              <tr key={l.id}>
                <td>{fechaCL(l.created_at)}</td>
                <td>{TIPOS[l.tipo]}</td>
                <td>{l.descripcion || '—'}</td>
                <td className="n">{num(l.cantidad)}</td>
                <td className="mono muted">{l.desde ? `${l.desde} a ${l.hasta}` : 'importados'}</td>
                <td><a className="btn chico" target="_blank" href={`/admin/tarjetas/imprimir/?lote=${l.id}`}>Imprimir</a></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
