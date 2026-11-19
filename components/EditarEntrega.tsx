'use client';
import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { cargarTabla, errorAmigable } from '@/lib/datos';
import { formatearRut, fechaCL, horaCorta, num } from '@/lib/util';
import type { Fila } from '@/lib/reportes';

type Modo = 'editar' | 'anular' | 'restaurar' | 'validar';

const TITULOS: Record<Modo, string> = {
  editar: 'Editar registro',
  anular: 'Anular registro',
  restaurar: 'Restaurar registro anulado',
  validar: 'Validar lectura duplicada',
};

// Maestros para el formulario (se cargan una vez por sesión)
let cacheMaestros: any = null;
async function maestros() {
  if (cacheMaestros) return cacheMaestros;
  const [huertos, cuarteles, envases, calidades, turnos, contratistas, trabajadores] = await Promise.all([
    cargarTabla('huertos', 'id,nombre', undefined, 'orden'),
    cargarTabla('cuarteles', 'id,nombre,huerto_id,activo', undefined, 'nombre'),
    cargarTabla('envases', 'id,nombre,kilos_referencia', undefined, 'nombre'),
    cargarTabla('calidades', 'id,nombre', undefined, 'orden'),
    cargarTabla('turnos', 'id,nombre', undefined, 'orden'),
    cargarTabla('contratistas', 'id,nombre', undefined, 'nombre'),
    cargarTabla('trabajadores', 'id,rut,nombres,apellido_paterno,apellido_materno', undefined, 'apellido_paterno'),
  ]);
  cacheMaestros = { huertos, cuarteles, envases, calidades, turnos, contratistas, trabajadores };
  return cacheMaestros;
}

/** Ventana para editar / anular / restaurar una entrega. El motivo es obligatorio y queda en la bitácora. */
export default function EditarEntrega({ fila, modo, onCerrar, onListo }: {
  fila: Fila; modo: Modo; onCerrar: () => void; onListo: () => void;
}) {
  const [m, setM] = useState<any>(null);
  const [f, setF] = useState<any>({
    cuartel_id: fila.cuartel_id, trabajador_id: fila.trabajador_id, envase_id: fila.envase_id,
    calidad_id: fila.calidad_id ?? '', turno_id: fila.turno_id ?? '', contratista_id: fila.contratista_id ?? '',
    cantidad: fila.cantidad, fecha: fila.fecha,
  });
  const [buscar, setBuscar] = useState('');
  const [motivo, setMotivo] = useState('');
  const [error, setError] = useState('');
  const [guardando, setGuardando] = useState(false);

  useEffect(() => { if (modo === 'editar') maestros().then(setM); }, [modo]);

  const trabajadoresFiltrados = useMemo(() => {
    if (!m) return [];
    const b = buscar.toLowerCase();
    const l = m.trabajadores.filter((t: any) => !b || `${t.rut} ${t.nombres} ${t.apellido_paterno ?? ''} ${t.apellido_materno ?? ''}`.toLowerCase().includes(b));
    // asegurar que el actual siempre esté en la lista
    if (!l.some((t: any) => t.id === f.trabajador_id)) {
      const act = m.trabajadores.find((t: any) => t.id === f.trabajador_id);
      if (act) l.unshift(act);
    }
    return l.slice(0, 200);
  }, [m, buscar, f.trabajador_id]);

  async function confirmar(e: React.FormEvent) {
    e.preventDefault();
    if (motivo.trim().length < 3) { setError('Escribe el motivo (mínimo 3 letras).'); return; }
    setGuardando(true); setError('');
    let res;
    if (modo === 'editar') {
      // enviar solo lo que cambió
      const orig: any = { cuartel_id: fila.cuartel_id, trabajador_id: fila.trabajador_id, envase_id: fila.envase_id, calidad_id: fila.calidad_id ?? '', turno_id: fila.turno_id ?? '', contratista_id: fila.contratista_id ?? '', cantidad: fila.cantidad, fecha: fila.fecha };
      const cambios: any = {};
      Object.keys(f).forEach((k) => { if (String(f[k]) !== String(orig[k])) cambios[k] = k === 'cantidad' ? Number(f[k]) : f[k]; });
      if (!Object.keys(cambios).length) { setGuardando(false); setError('No cambiaste ningún dato.'); return; }
      if (cambios.cantidad !== undefined && !(cambios.cantidad > 0)) { setGuardando(false); setError('La cantidad debe ser mayor que 0.'); return; }
      res = await supabase.rpc('editar_entrega', { p_id: fila.id, p_cambios: cambios, p_motivo: motivo.trim() });
    } else if (modo === 'anular') {
      res = await supabase.rpc('anular_entrega', { p_id: fila.id, p_motivo: motivo.trim() });
    } else {
      res = await supabase.rpc('restaurar_entrega', { p_id: fila.id, p_motivo: motivo.trim() });
    }
    setGuardando(false);
    if (res.error) { setError(errorAmigable(res.error.message)); return; }
    onListo();
  }

  const set = (k: string, v: any) => setF({ ...f, [k]: v });
  const cuartelesPorHuerto = m ? m.huertos.map((h: any) => ({ h, cs: m.cuarteles.filter((c: any) => c.huerto_id === h.id && (c.activo || c.id === f.cuartel_id)) })) : [];

  return (
    <div className="modal-fondo" onClick={onCerrar}>
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={confirmar}>
        <div className="encabezado" style={{ marginBottom: '.6rem' }}>
          <h2 style={{ margin: 0 }}>{TITULOS[modo]}</h2>
          <button type="button" className="chico" onClick={onCerrar}>✕</button>
        </div>

        <div className="tarjeta fijos" style={{ marginBottom: '.8rem' }}>
          <div className="fijo"><span>Trabajador</span><b>{fila.trabajador}</b></div>
          <div className="fijo"><span>Fecha y hora</span><b>{fechaCL(fila.fecha)} {horaCorta(fila.leido_en)}</b></div>
          <div className="fijo"><span>Registro</span><b>{num(fila.cantidad, fila.cantidad % 1 ? 1 : 0)} {fila.envase} · {fila.cuartel}</b></div>
          <div className="fijo"><span>Registrado por</span><b>{fila.jefe || '—'}</b></div>
          {fila.motivo_anulacion && <div className="fijo"><span>Motivo anulación</span><b>{fila.motivo_anulacion}</b></div>}
        </div>

        {modo === 'editar' && !m && <p className="muted">Cargando datos…</p>}
        {modo === 'editar' && m && (
          <>
            <div className="campo">
              <label>Trabajador</label>
              <input placeholder="Buscar por nombre o RUT…" value={buscar} onChange={(e) => setBuscar(e.target.value)} style={{ marginBottom: '.3rem' }} />
              <select value={f.trabajador_id} onChange={(e) => set('trabajador_id', e.target.value)}>
                {trabajadoresFiltrados.map((t: any) => (
                  <option key={t.id} value={t.id}>{t.nombres} {t.apellido_paterno ?? ''} {t.apellido_materno ?? ''} · {formatearRut(t.rut)}</option>
                ))}
              </select>
            </div>
            <div className="fila">
              <div className="campo">
                <label>Cuartel</label>
                <select value={f.cuartel_id} onChange={(e) => set('cuartel_id', e.target.value)}>
                  {cuartelesPorHuerto.map(({ h, cs }: any) => (
                    <optgroup key={h.id} label={h.nombre}>
                      {cs.map((c: any) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                    </optgroup>
                  ))}
                </select>
              </div>
              <div className="campo">
                <label>Fecha</label>
                <input type="date" value={f.fecha} onChange={(e) => set('fecha', e.target.value)} />
              </div>
            </div>
            <div className="fila">
              <div className="campo">
                <label>Envase</label>
                <select value={f.envase_id} onChange={(e) => set('envase_id', e.target.value)}>
                  {m.envases.map((x: any) => <option key={x.id} value={x.id}>{x.nombre}</option>)}
                </select>
              </div>
              <div className="campo">
                <label>Cantidad</label>
                <input type="number" min={0.5} step={0.5} value={f.cantidad} onChange={(e) => set('cantidad', e.target.value)} />
              </div>
            </div>
            <div className="fila">
              <div className="campo">
                <label>Calidad</label>
                <select value={f.calidad_id} onChange={(e) => set('calidad_id', e.target.value)}>
                  <option value="">—</option>
                  {m.calidades.map((x: any) => <option key={x.id} value={x.id}>{x.nombre}</option>)}
                </select>
              </div>
              <div className="campo">
                <label>Jornada</label>
                <select value={f.turno_id} onChange={(e) => set('turno_id', e.target.value)}>
                  <option value="">—</option>
                  {m.turnos.map((x: any) => <option key={x.id} value={x.id}>{x.nombre}</option>)}
                </select>
              </div>
            </div>
            {m.contratistas.length > 0 && (
              <div className="campo">
                <label>Contratista</label>
                <select value={f.contratista_id} onChange={(e) => set('contratista_id', e.target.value)}>
                  <option value="">Directo</option>
                  {m.contratistas.map((x: any) => <option key={x.id} value={x.id}>{x.nombre}</option>)}
                </select>
              </div>
            )}
          </>
        )}

        {modo === 'anular' && (
          <div className="alerta aviso">El registro no se borra: queda guardado como anulado, fuera de reportes y pagos. Se puede revisar y restaurar en <b>Anulados y cambios</b>.</div>
        )}

        <div className="campo">
          <label>Motivo {modo === 'editar' ? 'de la edición' : modo === 'anular' ? 'de la anulación' : ''} *</label>
          <textarea rows={2} required value={motivo} onChange={(e) => setMotivo(e.target.value)}
            placeholder={modo === 'anular' ? 'Ej: entrega registrada dos veces' : modo === 'editar' ? 'Ej: se registró en el cuartel equivocado' : 'Ej: se anuló por error'} />
        </div>
        {error && <div className="alerta error">{error}</div>}
        <div className="acciones">
          <button className={modo === 'anular' ? 'peligro' : 'primario'} disabled={guardando}>
            {guardando ? 'Guardando…' : modo === 'editar' ? 'Guardar cambios' : modo === 'anular' ? 'Anular registro' : modo === 'validar' ? 'Validar' : 'Restaurar'}
          </button>
          <button type="button" onClick={onCerrar}>Cancelar</button>
        </div>
      </form>
    </div>
  );
}
