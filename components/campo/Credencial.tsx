'use client';
import { useEffect, useState } from 'react';
import CapturaQR from '@/components/CapturaQR';
import { db, usuarioActual } from '@/lib/offline';
import { Config, Maestros, nombreTrabajador, registrarAsignacionLocal } from '@/lib/campo';
import { beep, formatearRut, normalizarCodigo, normalizarRut, rutDesdeQR, rutValido, tipoCodigo, uuid, vibrar } from '@/lib/util';

type Paso = 'rut' | 'datos' | 'credencial' | 'listo';

const PROPIO = 'propio';

/** ¿Para quién trabaja? Propio (interno) o uno de los contratistas */
function SelectorContratista({ m, valor, onChange }: { m: Maestros; valor: string; onChange: (v: string) => void }) {
  const opciones = [{ id: PROPIO, nombre: 'Propio / interno' }, ...m.contratistas.map((c) => ({ id: c.id, nombre: c.nombre }))];
  return (
    <div className="campo">
      <label>¿Para quién trabaja? *</label>
      <div className="opciones-lista">
        {opciones.map((o) => (
          <button type="button" key={o.id} className={valor === o.id ? 'activo' : ''} onClick={() => onChange(o.id)}>
            {valor === o.id ? '● ' : '○ '}{o.nombre}
          </button>
        ))}
      </div>
      {!m.contratistas.length && <div className="muted" style={{ fontSize: '.85rem', marginTop: '.3rem' }}>No hay contratistas creados. Administración los agrega en Huertos y maestros.</div>}
    </div>
  );
}

export default function Credencial({ m, cfg, prefill, limpiarPrefill, onCambio }: {
  m: Maestros; cfg: Config; prefill: string; limpiarPrefill: () => void; onCambio: () => void;
}) {
  const [paso, setPaso] = useState<Paso>('rut');
  const [rut, setRut] = useState('');
  const [extranjero, setExtranjero] = useState(false);
  const [trab, setTrab] = useState<any | null>(null);
  const [datos, setDatos] = useState({ nombres: '', apellido_paterno: '', apellido_materno: '' });
  const [codigo, setCodigo] = useState('');
  const [contr, setContr] = useState(''); // PROPIO o id de contratista; '' = sin elegir
  const [aviso, setAviso] = useState<{ t: string; m: string; forzable?: boolean } | null>(null);

  useEffect(() => { if (prefill) setCodigo(prefill); }, [prefill]);

  function reiniciar() {
    setPaso('rut'); setRut(''); setTrab(null); setExtranjero(false);
    setDatos({ nombres: '', apellido_paterno: '', apellido_materno: '' });
    setCodigo(''); setAviso(null); setContr(''); limpiarPrefill();
  }

  function usarRut(valor: string) {
    const r = extranjero ? valor.trim().toUpperCase() : normalizarRut(valor);
    if (!extranjero && !rutValido(r)) { setAviso({ t: 'error', m: 'RUT inválido. Revisa el dígito verificador.' }); beep(false); return; }
    setRut(r); setAviso(null);
    const t = m.trabajadores.find((x) => x.rut === r);
    beep(true); vibrar(60);
    if (t) {
      setTrab(t);
      setContr(t.contratista_id || PROPIO);
      if (t.estado === 'B') { setAviso({ t: 'error', m: 'Trabajador bloqueado. Enviar a administración.' }); return; }
      setPaso(prefill ? 'credencial' : 'credencial');
    } else {
      setTrab(null);
      setContr(m.contratistas.length ? '' : PROPIO);
      setPaso('datos');
    }
  }

  function onScanRut(texto: string): boolean | void {
    const r = rutDesdeQR(texto);
    if (!r) { setAviso({ t: 'error', m: 'No es el QR de un carnet. Intenta de nuevo o escribe el RUT.' }); beep(false); return false; }
    usarRut(r);
  }

  async function asignar(cod: string, forzar = false) {
    const c = normalizarCodigo(cod);
    if (tipoCodigo(c) !== 'W') { setAviso({ t: 'error', m: 'Ese código no es una credencial de trabajador.' }); beep(false); vibrar([200, 100, 200]); return; }
    if (!contr) { setAviso({ t: 'error', m: 'Elige si es trabajador propio o de un contratista.' }); beep(false); return; }
    const contratistaId = contr === PROPIO ? null : contr;
    const cambiaContr = !!trab && (trab.contratista_id ?? null) !== contratistaId;
    const trabajador = trab ? { ...trab, contratista_id: contratistaId } : {
      id: 'local:' + rut, rut, extranjero, estado: 'A',
      nombres: datos.nombres.trim(), apellido_paterno: datos.apellido_paterno.trim() || null,
      apellido_materno: datos.apellido_materno.trim() || null, contratista_id: contratistaId,
    };
    // validaciones locales (el servidor vuelve a validar al sincronizar)
    const enUso = m.credenciales.find((x) => x.codigo === c);
    if (!forzar && enUso && enUso.trabajador_id !== trabajador.id) {
      const otro = m.trabajadores.find((x) => x.id === enUso.trabajador_id);
      setCodigo(c);
      setAviso({ t: 'aviso', m: `Esta credencial está asignada a ${nombreTrabajador(otro) || 'otro trabajador'}.`, forzable: true });
      beep(false); vibrar(300);
      return;
    }
    const propia = m.credenciales.find((x) => x.trabajador_id === trabajador.id && x.codigo !== c);
    if (!forzar && propia) {
      setCodigo(c);
      setAviso({ t: 'aviso', m: `${nombreTrabajador(trabajador)} ya tiene la credencial ${propia.codigo}. ¿Reemplazarla por la nueva?`, forzable: true });
      beep(false); vibrar(300);
      return;
    }
    await db.asignaciones.add({
      id: uuid(), codigo: c, rut, nombres: trabajador.nombres, apellido_paterno: trabajador.apellido_paterno || undefined,
      apellido_materno: trabajador.apellido_materno || undefined, contratista_id: contratistaId,
      actualiza_contratista: cambiaContr, extranjero, forzar, creado_en: new Date().toISOString(), usuario: usuarioActual(), sync: 0,
    });
    await registrarAsignacionLocal(c, trabajador);
    setCodigo(c);
    setTrab(trabajador);
    setPaso('listo');
    setAviso(null);
    beep(true); vibrar(80);
    onCambio();
  }

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>Asignar credencial</h2>

      {paso === 'rut' && (
        <>
          <p className="muted" style={{ marginTop: 0 }}>1. Lee el QR del carnet del trabajador o escribe su RUT.</p>
          {!extranjero && (
            <>
              <CapturaQR etiqueta="Capturar carnet" onScan={(t) => onScanRut(t)} ayuda="Carnet a 15 a 20 cm, sin reflejo" />
            </>
          )}
          <div className="fila" style={{ marginTop: '.6rem' }}>
            <input placeholder={extranjero ? 'N° de documento' : 'RUT 12.345.678-9'} value={rut} onChange={(e) => setRut(e.target.value)} inputMode={extranjero ? 'text' : 'text'} />
            <button className="primario" style={{ flex: '0 0 auto' }} onClick={() => usarRut(rut)}>Siguiente</button>
          </div>
          <div className="acciones" style={{ marginTop: '.6rem' }}>
            {cfg.permite_rut_extranjero && (
              <label className="check"><input type="checkbox" checked={extranjero} onChange={(e) => setExtranjero(e.target.checked)} /> Extranjero sin RUT</label>
            )}
          </div>
        </>
      )}

      {paso === 'datos' && (
        <>
          <div className="alerta info">Trabajador nuevo: <b>{extranjero ? rut : formatearRut(rut)}</b>. Completa sus datos.</div>
          <div className="campo"><label>Nombres *</label><input value={datos.nombres} onChange={(e) => setDatos({ ...datos, nombres: e.target.value })} autoFocus /></div>
          <div className="campo"><label>Apellido paterno *</label><input value={datos.apellido_paterno} onChange={(e) => setDatos({ ...datos, apellido_paterno: e.target.value })} /></div>
          <div className="campo"><label>Apellido materno</label><input value={datos.apellido_materno} onChange={(e) => setDatos({ ...datos, apellido_materno: e.target.value })} /></div>
          <SelectorContratista m={m} valor={contr} onChange={setContr} />
          <button className="primario grande" disabled={!datos.nombres.trim() || !datos.apellido_paterno.trim() || !contr} onClick={() => setPaso('credencial')}>Siguiente</button>
          <button className="grande" style={{ marginTop: '.5rem' }} onClick={reiniciar}>Cancelar</button>
        </>
      )}

      {paso === 'credencial' && (
        <>
          <div className="resultado ok">
            <div className="nombre">{trab ? nombreTrabajador(trab) : `${datos.nombres} ${datos.apellido_paterno}`}</div>
            <div>{extranjero ? rut : formatearRut(rut)}</div>
            <div className="muted">{contr === PROPIO ? 'Propio / interno' : m.contratistas.find((c) => c.id === contr)?.nombre ?? ''}</div>
          </div>
          {trab && <SelectorContratista m={m} valor={contr} onChange={setContr} />}
          {trab && contr && (trab.contratista_id || PROPIO) !== contr && <div className="alerta aviso">Se cambiará el contratista de este trabajador.</div>}
          <p className="muted">2. Lee la credencial QR que le vas a entregar.</p>
          {!aviso?.forzable && <CapturaQR etiqueta="Capturar credencial" onScan={(t) => asignar(t)} />}
          {!aviso?.forzable && (
            <div className="fila" style={{ marginTop: '.6rem' }}>
              <input placeholder="o escribe el código" value={codigo} onChange={(e) => setCodigo(e.target.value)} className="mono" />
              <button style={{ flex: '0 0 auto' }} onClick={() => asignar(codigo)}>Asignar</button>
            </div>
          )}
          {aviso?.forzable && (
            <div className="acciones" style={{ marginTop: '.6rem' }}>
              <button className="primario grande" style={{ flex: 1 }} onClick={() => asignar(codigo, true)}>Sí, reasignar</button>
              <button className="grande" style={{ flex: 1 }} onClick={() => setAviso(null)}>No</button>
            </div>
          )}
          <button className="grande" style={{ marginTop: '.5rem' }} onClick={reiniciar}>Cancelar</button>
        </>
      )}

      {paso === 'listo' && (
        <>
          <div className="resultado ok">
            <div className="nombre">✔ Credencial asignada</div>
            <div>{nombreTrabajador(trab)}</div>
            <div>{trab?.contratista_id ? m.contratistas.find((c) => c.id === trab.contratista_id)?.nombre : 'Propio / interno'}</div>
            <div className="mono" style={{ fontSize: '.85rem' }}>{codigo}</div>
          </div>
          <p className="muted">Ya puede entregar. Se confirma con el servidor al sincronizar.</p>
          <button className="primario grande" onClick={reiniciar}>Asignar otra</button>
        </>
      )}

      {aviso && <div className={`alerta ${aviso.t}`}>{aviso.m}</div>}
    </div>
  );
}
