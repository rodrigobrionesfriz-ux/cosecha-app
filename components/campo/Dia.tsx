'use client';
import { Dia, Maestros, configDe, faltantesDia } from '@/lib/campo';

export default function DiaTab({ m, dia, setDia, listo }: { m: Maestros; dia: Dia; setDia: (d: Dia) => void; listo: () => void }) {
  const cfg = configDe(m, dia.huerto_id);
  const cuarteles = m.cuarteles.filter((c) => c.huerto_id === dia.huerto_id);
  const variedad = (id: string) => m.variedades.find((v) => v.id === id)?.nombre;
  const cuadrillas = m.cuadrillas.filter((c) => !c.huerto_id || c.huerto_id === dia.huerto_id);
  const falta = faltantesDia(dia, cfg, m);

  const sel = (k: keyof Dia, label: string, opciones: { v: string; t: string }[], req = false) => (
    <div className="campo">
      <label>{label}{req && ' *'}</label>
      <select value={dia[k] ?? ''} onChange={(e) => {
        const d = { ...dia, [k]: e.target.value || undefined };
        if (k === 'huerto_id') { d.cuartel_id = undefined; d.cuadrilla_id = undefined; }
        setDia(d);
      }} style={{ fontSize: '1.05rem', padding: '.75rem' }}>
        <option value="">Seleccionar…</option>
        {opciones.map((o) => <option key={o.v} value={o.v}>{o.t}</option>)}
      </select>
    </div>
  );

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>Configuración del día</h2>
      {sel('huerto_id', 'Huerto', m.huertos.map((h) => ({ v: h.id, t: h.nombre })), true)}
      {sel('cuartel_id', 'Cuartel', cuarteles.map((c) => ({ v: c.id, t: c.nombre + (c.variedad_id ? ` · ${variedad(c.variedad_id)}` : '') })), true)}
      {sel('envase_id', 'Envase', m.envases.map((e) => ({ v: e.id, t: e.nombre + (Number(e.kilos_referencia) ? ` (${e.kilos_referencia} kg)` : '') })), true)}
      {m.calidades.length > 0 && sel('calidad_id', 'Calidad', m.calidades.map((c) => ({ v: c.id, t: c.nombre })), cfg.exige_calidad)}
      {m.turnos.length > 0 && sel('turno_id', 'Turno', m.turnos.map((c) => ({ v: c.id, t: c.nombre })), cfg.exige_turno)}
      {m.contratistas.length > 0 && sel('contratista_id', 'Contratista (si toda la cuadrilla es de uno)', m.contratistas.map((c) => ({ v: c.id, t: c.nombre })), cfg.exige_contratista)}
      {cuadrillas.length > 0 && sel('cuadrilla_id', 'Cuadrilla', cuadrillas.map((c) => ({ v: c.id, t: c.nombre })))}

      {falta.length > 0 ? (
        <div className="alerta aviso">Falta: {falta.join(', ')}.</div>
      ) : (
        <button className="primario grande" onClick={listo}>Listo, a registrar</button>
      )}
      <p className="muted">
        Modo: <b>{cfg.modo_captura === 'credencial_caja' ? 'credencial + QR de cada caja' : 'credencial + cantidad'}</b>.
        La configuración queda guardada en el teléfono hasta que la cambies.
      </p>
    </div>
  );
}
