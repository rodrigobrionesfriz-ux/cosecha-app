'use client';
import { useState } from 'react';
import CapturaQR from '@/components/CapturaQR';
import { ESTADOS_BIN, estadoBin, registrarEvento } from '@/lib/bins';
import { configDe, Maestros } from '@/lib/campo';
import { beep, hablar, normalizarCodigo, num, tipoCodigo, uuid, vibrar } from '@/lib/util';
import type { Perfil } from '@/lib/auth';
import { FormCalidad, FotoLocal, Fotos, Msg, Resultado, validarCalidad, ValoresCalidad } from './Comunes';

/** Bin armado en acopio con bandejas que llegaron sueltas del campo */
export default function Armar({ m, perfil, onCambio }: { m: Maestros; perfil: Perfil; onCambio: () => void }) {
  const [huerto, setHuerto] = useState('');
  const [cuartel, setCuartel] = useState('');
  const [cuadrilla, setCuadrilla] = useState('');
  const [envase, setEnvase] = useState('');
  const [envases, setEnvases] = useState('');
  const [valores, setValores] = useState<ValoresCalidad>({});
  const [obs, setObs] = useState('');
  const [fotos, setFotos] = useState<FotoLocal[]>([]);
  const [msg, setMsg] = useState<Msg>(null);

  const cfg = configDe(m, huerto || undefined);
  const envaseId = envase || cfg.envase_id || '';
  const env = m.envases.find((e) => e.id === envaseId);
  const cuarteles = m.cuarteles_todos.filter((c) => c.huerto_id === huerto);
  const params = m.parametros_calidad.filter((p) => p.activo !== false).sort((a, b) => a.orden - b.orden);
  const n = Number(envases.replace(',', '.'));
  const faltan = [!huerto && 'huerto', !cuartel && 'cuartel', !envaseId && 'envase', !(n > 0) && 'cantidad de envases'].filter(Boolean) as string[];

  function error(titulo: string, detalle?: string) { setMsg({ t: 'err', titulo, detalle }); beep(false); vibrar([200, 100, 200]); }

  async function leer(texto: string): Promise<boolean | void> {
    if (faltan.length) return error('Completa los datos', `Falta: ${faltan.join(', ')}`);
    const codigo = normalizarCodigo(texto);
    if (tipoCodigo(codigo) !== 'L') { error('No es una etiqueta de bin', codigo.slice(0, 40)); return false; }
    const b = await estadoBin(codigo);
    if (b.estado) return error('Bin en uso', `${codigo} · ${ESTADOS_BIN[b.estado]}`);
    const v = validarCalidad(params, valores, !!cfg.exige_calidad_recepcion);
    if (!v.ok) return error('Revisa la calidad', v.error);
    const c = m.cuarteles_todos.find((x) => x.id === cuartel);
    await registrarEvento('armar', codigo, {
      huerto_id: huerto, cuartel_id: cuartel, variedad_id: c?.variedad_id ?? null, envase_id: envaseId,
      cuadrilla_id: cuadrilla || null, envases: n, calidad: v.datos, observacion: obs.trim() || null, fotos: fotos.map((f) => f.nombre),
    }, uuid(), fotos.map(({ nombre, blob }) => ({ nombre, blob })));
    beep(true); vibrar(80); hablar('Bin armado');
    setMsg({ t: 'ok', titulo: '✔ Bin armado y recibido', detalle: `${codigo} · ${num(n)} ${env?.nombre?.toLowerCase() ?? 'envases'}` });
    setEnvases(''); setValores({}); setObs(''); setFotos([]);
    onCambio();
  }

  return (
    <div>
      <p className="muted" style={{ marginTop: 0 }}>Para bandejas que llegan sueltas: indica de dónde vienen y cuántas van en el bin, y luego captura su QR.</p>
      <div className="campo">
        <label>Huerto</label>
        <select value={huerto} onChange={(e) => { setHuerto(e.target.value); setCuartel(''); }}>
          <option value="">Seleccionar…</option>
          {m.huertos_todos.map((h) => <option key={h.id} value={h.id}>{h.nombre}</option>)}
        </select>
      </div>
      <div className="campo">
        <label>Cuartel</label>
        <select value={cuartel} onChange={(e) => setCuartel(e.target.value)} disabled={!huerto}>
          <option value="">Seleccionar…</option>
                {cuarteles.filter((c) => c.en_cosecha !== false).length > 0 && (
                  <optgroup label="En cosecha">
                    {cuarteles.filter((c) => c.en_cosecha !== false).map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                  </optgroup>
                )}
                {cuarteles.some((c) => c.en_cosecha === false) && (
                  <optgroup label="Otros cuarteles">
                    {cuarteles.filter((c) => c.en_cosecha === false).map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                  </optgroup>
                )}
        </select>
      </div>
      <div className="fila">
        <div className="campo">
          <label>Envase</label>
          <select value={envaseId} onChange={(e) => setEnvase(e.target.value)}>
            <option value="">Seleccionar…</option>
            {m.envases.map((x) => <option key={x.id} value={x.id}>{x.nombre}</option>)}
          </select>
        </div>
        <div className="campo">
          <label>Cantidad de envases</label>
          <input type="number" inputMode="numeric" min={1} value={envases} onChange={(e) => setEnvases(e.target.value)} />
        </div>
      </div>
      {m.cuadrillas.length > 0 && (
        <div className="campo">
          <label>Cuadrilla (opcional)</label>
          <select value={cuadrilla} onChange={(e) => setCuadrilla(e.target.value)}>
            <option value="">Sin cuadrilla</option>
            {m.cuadrillas.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
          </select>
        </div>
      )}
      {params.length > 0 && (
        <details className="tarjeta" open={!!cfg.exige_calidad_recepcion}>
          <summary>Calidad {cfg.exige_calidad_recepcion ? '(obligatoria)' : '(opcional)'}</summary>
          <FormCalidad params={params} valores={valores} setValores={setValores} />
        </details>
      )}
      <div className="campo">
        <label>Observación</label>
        <input value={obs} onChange={(e) => setObs(e.target.value)} placeholder="Opcional" />
      </div>
      <Fotos empresaId={perfil.empresa_id} fotos={fotos} setFotos={setFotos} />
      <div style={{ marginTop: '.8rem' }}>
        {faltan.length ? <div className="alerta aviso">Falta: {faltan.join(', ')}</div> : <CapturaQR etiqueta="Capturar QR del bin" onScan={leer} />}
      </div>
      <Resultado msg={msg} />
    </div>
  );
}
