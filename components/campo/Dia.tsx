'use client';
import { useEffect, useState } from 'react';
import { Dia, Maestros, configDe, faltantesAdmin, faltantesDia, jornadaActual } from '@/lib/campo';
import { BinAbierto, leerBinAbierto } from '@/lib/bins';

export default function DiaTab({ m, dia, setDia, listo }: { m: Maestros; dia: Dia; setDia: (d: Dia) => void; listo: () => void }) {
  const cfg = configDe(m, dia.huerto_id);
  const cuarteles = m.cuarteles.filter((c) => c.huerto_id === dia.huerto_id);
  const variedad = (id: string) => m.variedades.find((v) => v.id === id)?.nombre;
  const cuadrillas = m.cuadrillas.filter((c) => !c.huerto_id || c.huerto_id === dia.huerto_id);
  const falta = faltantesDia(dia, cfg, m);
  const faltaAdmin = dia.huerto_id ? faltantesAdmin(cfg, m) : [];
  const envase = m.envases.find((e) => e.id === cfg.envase_id);
  const calidad = m.calidades.find((c) => c.id === cfg.calidad_id);
  const [jornada, setJornada] = useState(jornadaActual(m, cfg));
  const [bin, setBin] = useState<BinAbierto | null>(null);
  useEffect(() => { leerBinAbierto().then(setBin); }, [m]);
  const cuartelBin = bin ? m.cuarteles.find((c) => c.id === bin.cuartel_id) : null;
  const binOtroCuartel = !!bin && !!dia.cuartel_id && bin.cuartel_id !== dia.cuartel_id;

  useEffect(() => {
    setJornada(jornadaActual(m, cfg));
    const t = setInterval(() => setJornada(jornadaActual(m, cfg)), 60000);
    return () => clearInterval(t);
  }, [m, cfg.hora_inicio_tarde]); // eslint-disable-line

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
      {m.contratistas.length > 0 && sel('contratista_id', 'Contratista (si toda la cuadrilla es de uno)', m.contratistas.map((c) => ({ v: c.id, t: c.nombre })), cfg.exige_contratista)}
      {cuadrillas.length > 0 && sel('cuadrilla_id', 'Cuadrilla', cuadrillas.map((c) => ({ v: c.id, t: c.nombre })))}

      {dia.huerto_id && (
        <div className="tarjeta fijos">
          <div className="muted" style={{ fontSize: '.8rem', marginBottom: '.4rem' }}>Definido por administración</div>
          <div className="fijo"><span>Envase</span><b>{envase ? `${envase.nombre}${Number(envase.kilos_referencia) ? ` (${envase.kilos_referencia} kg)` : ''}` : '—'}</b></div>
          <div className="fijo"><span>Calidad</span><b>{calidad?.nombre ?? (m.calidades.length ? '—' : 'No aplica')}</b></div>
          <div className="fijo"><span>Jornada</span><b>{jornada.nombre} <span className="badge">automática</span></b></div>
        </div>
      )}

      {faltaAdmin.length > 0 && (
        <div className="alerta error">
          El administrador aún no define <b>{faltaAdmin.join(' y ')}</b> para este huerto. No se puede registrar hasta que lo haga (Panel → Reglas y tarifas) y sincronices.
        </div>
      )}

      {cfg.usa_bins && bin && (
        <div className={`alerta ${binOtroCuartel ? 'error' : 'ok'}`}>
          Bin abierto: <b className="mono">{bin.codigo.slice(-6)}</b> del cuartel <b>{cuartelBin?.nombre ?? '—'}</b>.
          {binOtroCuartel && ' Para cambiar de cuartel, primero cierra ese bin en Registrar.'}
        </div>
      )}

      {falta.length > 0 ? (
        <div className="alerta aviso">Falta: {falta.join(', ')}.</div>
      ) : !faltaAdmin.length && (
        <button className="primario grande" onClick={listo}>
          {cfg.usa_bins ? (bin ? 'Listo, seguir cosechando' : 'Listo, abrir bin') : 'Listo, a registrar'}
        </button>
      )}
      {cfg.usa_bins && (
        <p className="muted">
          Pasos del día: 1) huerto y cuartel, 2) abrir bin capturando su tarja, 3) registrar la cosecha.
          El bin se cierra solo al llegar a {cfg.max_envases_bin || 'su máximo de'} {envase?.nombre?.toLowerCase() ?? 'envases'} y queda listo para el acopio.
        </p>
      )}
      <p className="muted">
        Modo: <b>{cfg.modo_captura === 'credencial_caja' ? 'credencial + QR de cada caja' : 'credencial + cantidad'}</b>.
        La jornada cambia a Tarde a las {(cfg.hora_inicio_tarde || '13:00').slice(0, 5)}.
      </p>
    </div>
  );
}
