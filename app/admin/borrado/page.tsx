'use client';
import { useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { errorAmigable, useTabla } from '@/lib/datos';
import { fechaCL, horaCorta, hoyISO, num } from '@/lib/util';

const TIPOS: Record<string, string> = { pruebas: 'Datos de prueba', error_carga: 'Error de carga', otro: 'Otro' };
type Vista = { cantidad: number; envases: number; trabajadores: number; dias: number; jefes: number; desde: string | null; hasta: string | null };

export default function Borrado() {
  const { perfil } = useAuth();
  const huertos = useTabla<any>('huertos', 'id,nombre', 'orden');
  const historial = useTabla<any>('borrados', '*', 'creado_en');
  const hoy = hoyISO();
  const [desde, setDesde] = useState(hoy);
  const [hasta, setHasta] = useState(hoy);
  const [huerto, setHuerto] = useState('');
  const [vista, setVista] = useState<Vista | null>(null);
  const [tipo, setTipo] = useState('pruebas');
  const [motivo, setMotivo] = useState('');
  const [palabra, setPalabra] = useState('');
  const [entiendo, setEntiendo] = useState(false);
  const [msg, setMsg] = useState<{ t: string; m: string } | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [recuperar, setRecuperar] = useState<any | null>(null);
  const [motivoRec, setMotivoRec] = useState('');

  if (perfil?.rol !== 'admin') return <div className="alerta aviso">Solo administradores.</div>;

  const nombreHuerto = huertos.filas.find((h) => h.id === huerto)?.nombre ?? 'Todos los huertos';

  function limpiar() { setVista(null); setPalabra(''); setEntiendo(false); setMsg(null); }

  async function revisar() {
    if (hasta < desde) { setMsg({ t: 'error', m: 'La fecha "hasta" no puede ser anterior a "desde".' }); return; }
    setOcupado(true); setMsg(null); setPalabra(''); setEntiendo(false);
    const { data, error } = await supabase.rpc('previsualizar_borrado', { p_desde: desde, p_hasta: hasta, p_huerto: huerto || null });
    setOcupado(false);
    if (error) { setMsg({ t: 'error', m: errorAmigable(error.message) }); return; }
    setVista({ ...(data as any), cantidad: Number((data as any).cantidad), envases: Number((data as any).envases) });
  }

  const motivoOk = motivo.trim().length >= 10;
  const listo = !!vista && vista.cantidad > 0 && motivoOk && palabra === 'BORRAR' && entiendo;

  async function borrar() {
    if (!vista || !listo) return;
    const aviso = `Vas a borrar ${vista.cantidad} registros (${num(vista.envases)} envases, ${vista.trabajadores} trabajadores)\n` +
      `del ${fechaCL(desde)} al ${fechaCL(hasta)} · ${nombreHuerto}.\n\n` +
      `Dejarán de aparecer en reportes, pagos y teléfonos.\nPodrás recuperarlos desde el historial de esta página.\n\n¿Confirmas el borrado?`;
    if (!confirm(aviso)) return;
    setOcupado(true);
    const { data, error } = await supabase.rpc('borrar_entregas', {
      p_desde: desde, p_hasta: hasta, p_huerto: huerto || null, p_tipo: tipo,
      p_motivo: motivo.trim(), p_confirmacion: palabra, p_cantidad_esperada: vista.cantidad,
    });
    setOcupado(false);
    if (error) { setMsg({ t: 'error', m: errorAmigable(error.message) }); setVista(null); return; }
    setMsg({ t: 'ok', m: `Listo: ${(data as any).cantidad} registros enviados a la papelera. Puedes recuperarlos más abajo.` });
    setVista(null); setMotivo(''); setPalabra(''); setEntiendo(false);
    historial.recargar();
  }

  async function confirmarRecuperar() {
    if (motivoRec.trim().length < 3) { alert('Escribe el motivo de la recuperación.'); return; }
    if (!confirm(`¿Recuperar ${recuperar.cantidad} registros? Volverán a reportes, pagos y teléfonos.`)) return;
    const { data, error } = await supabase.rpc('recuperar_borrado', { p_id: recuperar.id, p_motivo: motivoRec.trim() });
    if (error) { alert(errorAmigable(error.message)); return; }
    alert(`Se recuperaron ${data} registros.`);
    setRecuperar(null); setMotivoRec('');
    historial.recargar();
  }

  const lista = [...historial.filas].reverse();

  return (
    <div>
      <h1>Borrado de datos</h1>
      <div className="alerta aviso">
        Úsalo para limpiar <b>datos de prueba</b> o cargas erróneas. Los registros no se eliminan: van a una papelera,
        dejan de contar en reportes, pagos y teléfonos, y se pueden <b>recuperar</b> en cualquier momento. Para corregir un registro puntual usa Editar o Anular en Reportes.
      </div>

      <div className="tarjeta">
        <h3 style={{ marginTop: 0 }}>1. Elige qué borrar</h3>
        <div className="fila">
          <div className="campo"><label>Desde</label><input type="date" value={desde} onChange={(e) => { setDesde(e.target.value); limpiar(); }} /></div>
          <div className="campo"><label>Hasta</label><input type="date" value={hasta} onChange={(e) => { setHasta(e.target.value); limpiar(); }} /></div>
          <div className="campo">
            <label>Huerto</label>
            <select value={huerto} onChange={(e) => { setHuerto(e.target.value); limpiar(); }}>
              <option value="">Todos los huertos</option>
              {huertos.filas.map((h) => <option key={h.id} value={h.id}>{h.nombre}</option>)}
            </select>
          </div>
          <div className="campo" style={{ flex: '0 0 auto' }}><button className="primario" onClick={revisar} disabled={ocupado}>Revisar</button></div>
        </div>

        {vista && vista.cantidad === 0 && <div className="alerta info">No hay registros con esos filtros.</div>}

        {vista && vista.cantidad > 0 && (
          <>
            <h3>2. Esto es lo que se borrará</h3>
            <div className="kpis">
              <div className="kpi"><div className="v" style={{ color: 'var(--cereza)' }}>{num(vista.cantidad)}</div><div className="l">Registros</div></div>
              <div className="kpi"><div className="v">{num(vista.envases)}</div><div className="l">Envases</div></div>
              <div className="kpi"><div className="v">{vista.trabajadores}</div><div className="l">Trabajadores</div></div>
              <div className="kpi"><div className="v">{vista.dias}</div><div className="l">Días con datos</div></div>
              <div className="kpi"><div className="v">{vista.jefes}</div><div className="l">Jefes / teléfonos</div></div>
            </div>
            <p className="muted" style={{ marginTop: 0 }}>Período con datos: {vista.desde ? `${fechaCL(vista.desde)} al ${fechaCL(vista.hasta!)}` : '—'} · {nombreHuerto}. Incluye válidos, duplicados y anulados.</p>

            <h3>3. Motivo</h3>
            <div className="fila">
              <div className="campo" style={{ flex: '0 1 220px' }}>
                <label>Tipo</label>
                <select value={tipo} onChange={(e) => setTipo(e.target.value)}>
                  {Object.entries(TIPOS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
              <div className="campo">
                <label>Detalle (mínimo 10 caracteres)</label>
                <input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ej: pruebas de la app antes de iniciar temporada" />
              </div>
            </div>

            <h3>4. Confirmación</h3>
            <div className="fila" style={{ alignItems: 'center' }}>
              <div className="campo" style={{ flex: '0 1 260px' }}>
                <label>Escribe <b>BORRAR</b> para habilitar el botón</label>
                <input value={palabra} onChange={(e) => setPalabra(e.target.value.toUpperCase())} className="mono" autoComplete="off" />
              </div>
              <label className="check" style={{ flex: '1 1 260px' }}>
                <input type="checkbox" checked={entiendo} onChange={(e) => setEntiendo(e.target.checked)} />
                Entiendo que {vista.cantidad} registros dejarán de contar en reportes y pagos.
              </label>
            </div>
            {!motivoOk && motivo && <div className="alerta aviso">El motivo debe tener al menos 10 caracteres.</div>}
            <div className="acciones" style={{ marginTop: '.6rem' }}>
              <button className="btn-borrar" onClick={borrar} disabled={!listo || ocupado}>🗑 Borrar {num(vista.cantidad)} registros</button>
              <button onClick={limpiar}>Cancelar</button>
            </div>
          </>
        )}
        {msg && <div className={`alerta ${msg.t}`}>{msg.m}</div>}
      </div>

      <h2>Historial de borrados</h2>
      <div className="tabla-wrap">
        <table>
          <thead><tr><th>Cuándo</th><th>Período</th><th>Huerto</th><th className="n">Registros</th><th>Tipo y motivo</th><th>Por</th><th>Estado</th></tr></thead>
          <tbody>
            {!lista.length && <tr><td colSpan={7} className="muted">Sin borrados.</td></tr>}
            {lista.map((b) => (
              <tr key={b.id}>
                <td>{fechaCL(b.creado_en)} {horaCorta(b.creado_en)}</td>
                <td>{fechaCL(b.filtros.desde)} al {fechaCL(b.filtros.hasta)}</td>
                <td>{b.filtros.huerto ?? 'Todos'}</td>
                <td className="n">{num(b.cantidad)}<br /><span className="muted">{num(b.envases)} env.</span></td>
                <td><span className="badge">{TIPOS[b.tipo]}</span><br />{b.motivo}</td>
                <td>{b.creado_por_nombre}</td>
                <td>
                  {b.recuperado_en ? (
                    <><span className="badge ok">Recuperado</span><br /><span className="muted" style={{ fontSize: '.8rem' }}>{fechaCL(b.recuperado_en)} · {b.recuperado_por_nombre}<br />{b.motivo_recuperacion}</span></>
                  ) : (
                    <><span className="badge err">En papelera</span><br /><button className="chico" style={{ marginTop: '.3rem' }} onClick={() => { setRecuperar(b); setMotivoRec(''); }}>Recuperar</button></>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {recuperar && (
        <div className="modal-fondo" onClick={() => setRecuperar(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2 style={{ marginTop: 0 }}>Recuperar registros</h2>
            <p>Se recuperarán <b>{num(recuperar.cantidad)} registros</b> del {fechaCL(recuperar.filtros.desde)} al {fechaCL(recuperar.filtros.hasta)} ({recuperar.filtros.huerto ?? 'todos los huertos'}), con el estado que tenían antes del borrado.</p>
            <div className="campo">
              <label>Motivo de la recuperación *</label>
              <input value={motivoRec} onChange={(e) => setMotivoRec(e.target.value)} placeholder="Ej: se borraron por error" />
            </div>
            <div className="acciones">
              <button className="primario" onClick={confirmarRecuperar}>Recuperar</button>
              <button onClick={() => setRecuperar(null)}>Cancelar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
