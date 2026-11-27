'use client';
import { useEffect, useState } from 'react';
import CapturaQR from '@/components/CapturaQR';
import { BinActual, BinServidor, deshacerEvento, ESTADOS_BIN, estadoBin, registrarEvento } from '@/lib/bins';
import { db, EventoLocal, getCache, usuarioActual } from '@/lib/offline';
import { configDe, Maestros } from '@/lib/campo';
import { beep, hablar, horaCorta, hoyISO, normalizarCodigo, tipoCodigo, uuid, vibrar } from '@/lib/util';
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
  const cuarteles = m.cuarteles.filter((c) => c.huerto_id === huerto);
  const nombreVariedad = (id?: string | null) => (id ? m.variedades.find((v) => v.id === id)?.nombre || '' : '');
  const [recientes, setRecientes] = useState<{ e: EventoLocal; estado: string | null }[]>([]);

  /** Recepciones de hoy hechas en este teléfono, con el estado actual del bin */
  async function cargarRecientes() {
    const inicio = new Date(hoyISO() + 'T00:00:00-03:00').toISOString();
    const uid = usuarioActual();
    const ev = (await db.eventos.where('hecho_en').above(inicio).toArray())
      .filter((e) => e.usuario === uid && (e.tipo === 'recibir' || e.tipo === 'armar') && (!e.resultado || e.resultado === 'OK'))
      .sort((a, b) => b.hecho_en.localeCompare(a.hecho_en));
    const vistos = new Set<string>();
    const l = [];
    for (const e of ev) {
      if (vistos.has(e.codigo)) continue; // solo la última recepción de cada bin
      vistos.add(e.codigo);
      l.push({ e, estado: (await estadoBin(e.codigo)).estado });
    }
    setRecientes(l.slice(0, 15));
  }
  useEffect(() => { cargarRecientes(); }, [m]); // eslint-disable-line

  async function deshacer(e: EventoLocal) {
    if (!confirm(`¿Deshacer la recepción del bin ${e.codigo}? Podrás recibirlo de nuevo.`)) return;
    const bins: BinServidor[] = (await getCache('bins_activos')) || [];
    const s = bins.find((b) => b.codigo === e.codigo);
    // si venía de campo vuelve a "cerrado"; si se creó al recibir o armar aquí, queda libre
    const previo = e.tipo === 'recibir' && s?.origen === 'campo' ? 'cerrado' : null;
    const r = await deshacerEvento(e, 'deshacer_recepcion', { estado_previo: previo });
    hablar('Recepción deshecha');
    setMsg({ t: 'ok', titulo: 'Recepción deshecha', detalle: `${e.codigo}${r === 'revertido' ? ' · se corrige en la nube al sincronizar' : ''}` });
    await cargarRecientes(); onCambio();
  }

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
    // huerto y cuartel: lo que dice el campo si ya sincronizó. Sin datos del campo solo se propone el
    // último huerto; el cuartel se elige mirando la tarja (evita arrastrar el cuartel del bin anterior)
    let ult: { h?: string; c?: string } = {};
    try { ult = JSON.parse(localStorage.getItem('acopio-ultimo-cuartel') || '{}'); } catch {}
    const h0 = b.servidor?.huerto_id || ult.h || '';
    const c0 = b.servidor?.cuartel_id || '';
    setHuerto(m.huertos.some((x) => x.id === h0) ? h0 : '');
    setCuartel(m.cuarteles.some((x) => x.id === c0 && x.huerto_id === h0) ? c0 : '');
    setVerCalidad(exige);
    setMsg(b.servidor ? null : { t: 'av', titulo: 'Sin datos del campo todavía', detalle: 'Elige el cuartel según lo anotado en la tarja del bin. Cuando el jefe sincronice, se concilia.' });
  }

  async function recibir() {
    if (!bin) return;
    if (!huerto || !cuartel) return error('Falta huerto y cuartel', 'Selecciona de dónde viene el bin antes de grabar.');
    const nTotes = Number(totes);
    if (!totes || !(nTotes >= 0) || !Number.isInteger(nTotes)) return error('Falta el conteo', 'Cuenta los totes del bin e ingresa la cantidad.');
    const v = validarCalidad(params, valores, exige);
    if (!v.ok) return error('Revisa la calidad', v.error);
    try { localStorage.setItem('acopio-ultimo-cuartel', JSON.stringify({ h: huerto, c: cuartel })); } catch {}
    const cu = m.cuarteles.find((x) => x.id === cuartel);
    await registrarEvento('recibir', bin.codigo, {
      huerto_id: huerto, cuartel_id: cuartel, variedad_id: cu?.variedad_id ?? null, envases: nTotes,
      calidad: v.datos, observacion: obs.trim() || null, fotos: fotos.map((f) => f.nombre),
    }, bin.id ?? uuid(), fotos.map(({ nombre, blob }) => ({ nombre, blob })));
    beep(true); vibrar(80); hablar('Recibido');
    setMsg({ t: 'ok', titulo: '✔ Bin recibido', detalle: bin.codigo });
    setBin(null);
    await cargarRecientes();
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
                {m.huertos.map((h) => <option key={h.id} value={h.id}>{h.nombre}</option>)}
              </select>
            </div>
            <div className="campo">
              <label>Cuartel *</label>
              <select value={cuartel} onChange={(e) => setCuartel(e.target.value)} disabled={!huerto}>
                <option value="">Seleccionar…</option>
                {cuarteles.map((c) => <option key={c.id} value={c.id}>{c.nombre}{nombreVariedad(c.variedad_id) ? ` · ${nombreVariedad(c.variedad_id)}` : ''}</option>)}
              </select>
            </div>
          </div>
          {cuartel && (
            <div className={`confirma-variedad ${bin.servidor ? '' : 'sin-campo'}`}>
              <span className="muted">Variedad</span>
              <b>{nombreVariedad(m.cuarteles.find((x) => x.id === cuartel)?.variedad_id) || 'Sin variedad'}</b>
              <span className="muted">{bin.servidor ? 'según el registro de campo' : 'confirma que coincide con la tarja del bin'}</span>
            </div>
          )}
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
      {recientes.length > 0 && (
        <>
          <h3>Recibidos hoy en este teléfono</h3>
          {recientes.map(({ e, estado }) => (
            <div key={e.id} className="rank-item">
              <div className="fila-sup">
                <b className="mono">{e.codigo}</b>
                <span className="muted">{horaCorta(e.hecho_en)}{e.sync ? '' : ' · por subir'}</span>
              </div>
              <div className="fila-sup" style={{ alignItems: 'center' }}>
                <span className="muted">{e.tipo === 'armar' ? 'Armado en acopio' : 'Recibido'}{e.datos?.envases != null ? ` · ${e.datos.envases} totes` : ''} · {estado ? ESTADOS_BIN[estado] : 'Despachado o deshecho'}</span>
                {estado === 'recibido' && <button className="chico" onClick={() => deshacer(e)}>↩ Deshacer</button>}
              </div>
            </div>
          ))}
          <p className="muted" style={{ fontSize: '.82rem' }}>Solo se puede deshacer un bin que sigue en acopio. Si ya está en un despacho abierto, primero quítalo del camión.</p>
        </>
      )}
    </div>
  );
}
