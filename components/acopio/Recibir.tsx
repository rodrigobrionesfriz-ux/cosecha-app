'use client';
import { useState } from 'react';
import CapturaQR from '@/components/CapturaQR';
import { BinActual, ESTADOS_BIN, estadoBin, registrarEvento } from '@/lib/bins';
import { configDe, Maestros } from '@/lib/campo';
import { beep, hablar, normalizarCodigo, tipoCodigo, uuid, vibrar } from '@/lib/util';
import type { Perfil } from '@/lib/auth';
import { FichaBin, FormCalidad, FotoLocal, Fotos, Msg, Resultado, validarCalidad, ValoresCalidad } from './Comunes';

export default function Recibir({ m, perfil, onCambio }: { m: Maestros; perfil: Perfil; onCambio: () => void }) {
  const [bin, setBin] = useState<BinActual | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  const [valores, setValores] = useState<ValoresCalidad>({});
  const [obs, setObs] = useState('');
  const [fotos, setFotos] = useState<FotoLocal[]>([]);
  const [verCalidad, setVerCalidad] = useState(false);
  const [manual, setManual] = useState('');
  const [huerto, setHuerto] = useState('');
  const [cuartel, setCuartel] = useState('');
  const [totes, setTotes] = useState('');
  const cuarteles = m.cuarteles_todos.filter((c) => c.huerto_id === huerto);

  const cfg = configDe(m, bin?.servidor?.huerto_id ?? undefined);
  const exige = !!cfg.exige_calidad_recepcion;
  const params = m.parametros_calidad.filter((p) => p.activo !== false).sort((a, b) => a.orden - b.orden);

  function error(titulo: string, detalle?: string) { setMsg({ t: 'err', titulo, detalle }); beep(false); vibrar([200, 100, 200]); }

  async function leer(texto: string): Promise<boolean | void> {
    const codigo = normalizarCodigo(texto);
    if (tipoCodigo(codigo) !== 'L') { error('No es una etiqueta de bin', codigo.slice(0, 40)); return false; }
    const b = await estadoBin(codigo);
    if (b.estado && !['abierto', 'cerrado'].includes(b.estado)) {
      error('Bin ya recibido', `${codigo} · ${ESTADOS_BIN[b.estado]}`);
      return;
    }
    beep(true); vibrar(60);
    setBin(b); setValores({}); setObs(''); setFotos([]); setTotes('');
    // huerto y cuartel: lo que dice el campo si ya sincronizó; si no, el último usado en acopio
    let ult: { h?: string; c?: string } = {};
    try { ult = JSON.parse(localStorage.getItem('acopio-ultimo-cuartel') || '{}'); } catch {}
    const h0 = b.servidor?.huerto_id || ult.h || '';
    const c0 = b.servidor?.cuartel_id || (h0 === ult.h ? ult.c : '') || '';
    setHuerto(m.huertos_todos.some((x) => x.id === h0) ? h0 : '');
    setCuartel(m.cuarteles_todos.some((x) => x.id === c0 && x.huerto_id === h0) ? c0 : '');
    setVerCalidad(exige);
    setMsg(b.servidor ? null : { t: 'av', titulo: 'Sin datos del campo todavía', detalle: 'Indica huerto y cuartel. Cuando el jefe sincronice, se concilia.' });
  }

  async function recibir() {
    if (!bin) return;
    if (!huerto || !cuartel) return error('Falta huerto y cuartel', 'Selecciona de dónde viene el bin antes de grabar.');
    const nTotes = Number(totes);
    if (!totes || !(nTotes >= 0) || !Number.isInteger(nTotes)) return error('Falta el conteo', 'Cuenta los totes del bin e ingresa la cantidad.');
    const v = validarCalidad(params, valores, exige);
    if (!v.ok) return error('Revisa la calidad', v.error);
    try { localStorage.setItem('acopio-ultimo-cuartel', JSON.stringify({ h: huerto, c: cuartel })); } catch {}
    const cu = m.cuarteles_todos.find((x) => x.id === cuartel);
    await registrarEvento('recibir', bin.codigo, {
      huerto_id: huerto, cuartel_id: cuartel, variedad_id: cu?.variedad_id ?? null, envases: nTotes,
      calidad: v.datos, observacion: obs.trim() || null, fotos: fotos.map((f) => f.nombre),
    }, bin.id ?? uuid(), fotos.map(({ nombre, blob }) => ({ nombre, blob })));
    beep(true); vibrar(80); hablar('Recibido');
    setMsg({ t: 'ok', titulo: '✔ Bin recibido', detalle: bin.codigo });
    setBin(null);
    onCambio();
  }

  if (bin) {
    return (
      <div>
        <FichaBin b={bin} ocultarEnvases />
        {bin.estado === 'abierto' && <div className="alerta aviso">El bin sigue abierto en campo: al recibirlo queda cerrado.</div>}
        <Resultado msg={msg} />

        <div className="tarjeta">
          <div className="fila">
            <div className="campo">
              <label>Huerto *</label>
              <select value={huerto} onChange={(e) => { setHuerto(e.target.value); setCuartel(''); }}>
                <option value="">Seleccionar…</option>
                {m.huertos_todos.map((h) => <option key={h.id} value={h.id}>{h.nombre}</option>)}
              </select>
            </div>
            <div className="campo">
              <label>Cuartel *</label>
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
          </div>
          {bin.servidor?.cuartel_id && cuartel && cuartel !== bin.servidor.cuartel_id && (
            <div className="alerta aviso" style={{ marginBottom: 0 }}>El campo registró este bin en <b>{bin.servidor.cuartel}</b>. Si grabas otro cuartel, administración lo revisa.</div>
          )}
          <div className="campo" style={{ marginTop: '.6rem' }}>
            <label>Totes contados en el bin *</label>
            <input type="number" inputMode="numeric" min={0} step={1} value={totes} onChange={(e) => setTotes(e.target.value)} style={{ fontSize: '1.4rem', fontWeight: 700 }} />
          </div>
          {bin.servidor && totes !== '' && Number(totes) !== Number(bin.servidor.envases) && (
            <div className="alerta aviso" style={{ marginBottom: 0 }}>El campo registró <b>{Number(bin.servidor.envases)}</b> en este bin. Vuelve a contar; si se mantiene la diferencia, administración la revisa.</div>
          )}
          {!bin.servidor && <div className="muted" style={{ fontSize: '.85rem' }}>El jefe aún no sincroniza este bin. Al subir sus datos se compara cuartel y cantidad con lo que indiques aquí.</div>}
        </div>

        {params.length > 0 && (
          <div className="tarjeta">
            <button type="button" className="enlace" onClick={() => setVerCalidad(!verCalidad)}>
              {verCalidad ? '▾' : '▸'} Calidad {exige ? '(obligatoria)' : '(opcional)'}
            </button>
            {verCalidad && <FormCalidad params={params} valores={valores} setValores={setValores} />}
          </div>
        )}
        <div className="campo">
          <label>Observación</label>
          <input value={obs} onChange={(e) => setObs(e.target.value)} placeholder="Opcional" />
        </div>
        <Fotos empresaId={perfil.empresa_id} fotos={fotos} setFotos={setFotos} />
        <button className="primario grande" style={{ marginTop: '.8rem' }} onClick={recibir} disabled={!huerto || !cuartel || totes === ''}>Registrar recepción</button>
        <button className="grande" style={{ marginTop: '.5rem' }} onClick={() => { setBin(null); setMsg(null); }}>Cancelar</button>
      </div>
    );
  }

  return (
    <div>
      <CapturaQR etiqueta="Capturar bin que llega" onScan={leer} />
      <Resultado msg={msg} />
      <details style={{ marginTop: '1rem' }}>
        <summary className="muted">Escribir código</summary>
        <div className="fila" style={{ marginTop: '.6rem' }}>
          <input className="mono" placeholder="BC-L-…" value={manual} onChange={(e) => setManual(e.target.value)} />
          <button style={{ flex: '0 0 auto' }} onClick={() => { leer(manual); setManual(''); }}>OK</button>
        </div>
      </details>
    </div>
  );
}
