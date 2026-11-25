'use client';
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { cargarTabla, errorAmigable } from '@/lib/datos';
import { beep, completarCodigo, tipoCodigo, uuid, vibrar } from '@/lib/util';
import CapturaQR from '@/components/CapturaQR';

export type TrabajadorCred = { id: string; rut: string; extranjero?: boolean; nombre: string; contratista_id?: string | null };

const MENSAJES: Record<string, string> = {
  RI: 'RUT inválido.',
  CI: 'Esa credencial no existe o está anulada. Revisa que esté generada o registrada en Tarjetas QR (las de HubCrop se registran ahí escaneándolas).',
  TN: 'El trabajador no está registrado.',
  TB: 'El trabajador está bloqueado. No se le puede asignar credencial.',
};

/**
 * Asigna (o cambia) la credencial QR de un trabajador desde el panel: se escanea con la cámara
 * o se escribe el código. Usa la misma función del servidor que el teléfono del jefe.
 */
export default function AsignarCredencial({ t, onCerrar, onAsignada }: { t: TrabajadorCred; onCerrar: () => void; onAsignada?: (codigo: string) => void }) {
  const [actual, setActual] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);
  const [codigo, setCodigo] = useState('');
  const [aviso, setAviso] = useState<{ t: 'ok' | 'error' | 'aviso'; m: string; forzar?: string } | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [camara, setCamara] = useState(true);

  async function cargarActual() {
    setCargando(true);
    const [c] = await cargarTabla<any>('tarjetas', 'codigo', (q) => q.eq('trabajador_id', t.id).eq('estado', 'asignada').eq('tipo', 'W'));
    setActual(c?.codigo ?? null); setCargando(false);
  }
  useEffect(() => { cargarActual(); }, [t.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function asignar(cod: string, forzar = false) {
    const c = completarCodigo(cod, 'W');
    if (tipoCodigo(c) !== 'W') { setAviso({ t: 'error', m: 'Ese código no es una credencial de trabajador (debe empezar con BC-W-).' }); beep(false); return false; }
    if (c === actual) { setAviso({ t: 'ok', m: `${c} ya es la credencial de ${t.nombre}.` }); return true; }
    // ¿la credencial ya es de otra persona?
    if (!forzar) {
      const [otra] = await cargarTabla<any>('tarjetas', 'trabajador_id,estado', (q) => q.eq('codigo', c));
      if (otra?.estado === 'asignada' && otra.trabajador_id && otra.trabajador_id !== t.id) {
        const [o] = await cargarTabla<any>('trabajadores', 'nombres,apellido_paterno', (q) => q.eq('id', otra.trabajador_id));
        setCodigo(c);
        setAviso({ t: 'aviso', m: `La credencial ${c} está asignada a ${o ? `${o.nombres} ${o.apellido_paterno ?? ''}` : 'otro trabajador'}. Si la reasignas, esa persona queda sin credencial.`, forzar: c });
        beep(false); vibrar(300); return false;
      }
      if (actual) {
        setCodigo(c);
        setAviso({ t: 'aviso', m: `${t.nombre} ya tiene la credencial ${actual}. ¿Reemplazarla por ${c}? La anterior queda libre.`, forzar: c });
        return false;
      }
    }
    setOcupado(true);
    const { data, error } = await supabase.rpc('asignar_credencial', {
      p_id: uuid(), p_codigo: c, p_rut: t.rut, p_extranjero: !!t.extranjero, p_forzar: forzar,
      p_contratista_id: t.contratista_id ?? null, p_actualiza_contratista: false,
    });
    setOcupado(false);
    if (error) { setAviso({ t: 'error', m: errorAmigable(error.message) }); beep(false); return false; }
    const r = (data as any)?.resultado as string;
    if (r === 'CR') {
      beep(true); vibrar(60);
      setActual(c); setCodigo(''); setCamara(false);
      setAviso({ t: 'ok', m: `Credencial ${c} asignada a ${t.nombre}.` });
      onAsignada?.(c);
      return true;
    }
    if (r === 'DC' || r === 'DR') { setAviso({ t: 'aviso', m: r === 'DC' ? 'Esa credencial está asignada a otro trabajador.' : 'El trabajador ya tiene otra credencial.', forzar: c }); return false; }
    setAviso({ t: 'error', m: MENSAJES[r] || `No se pudo asignar (${r}).` }); beep(false);
    return false;
  }

  async function liberar() {
    if (!actual || !confirm(`¿Liberar la credencial ${actual} de ${t.nombre}? Queda disponible para otra persona.`)) return;
    setOcupado(true);
    const { error } = await supabase.rpc('liberar_credencial', { p_codigo: actual });
    setOcupado(false);
    if (error) { setAviso({ t: 'error', m: errorAmigable(error.message) }); return; }
    setAviso({ t: 'ok', m: `Credencial ${actual} liberada.` }); setActual(null); setCamara(true);
    onAsignada?.('');
  }

  return (
    <section className="tarjeta asignar-cred">
      <div className="asignar-cab">
        <div>
          <h3 style={{ margin: 0 }}>🪪 Credencial del cosechero</h3>
          <div className="muted">{t.nombre}</div>
        </div>
        <button type="button" className="chico" onClick={onCerrar}>Cerrar</button>
      </div>
      <div className="asignar-actual">
        {cargando ? <span className="muted">Buscando credencial…</span>
          : actual ? <>Credencial actual: <b className="mono">{actual}</b> <button type="button" className="chico" onClick={liberar} disabled={ocupado}>Liberar</button></>
            : <span className="muted">Sin credencial asignada.</span>}
      </div>
      {camara
        ? <CapturaQR etiqueta={actual ? 'Escanear credencial nueva' : 'Escanear credencial QR'} ayuda="Apunta al QR de la credencial que le vas a entregar" onScan={(x) => { asignar(x); return true; }} alto={220} />
        : <button type="button" onClick={() => { setCamara(true); setAviso(null); }}>📷 {actual ? 'Cambiar credencial' : 'Escanear credencial'}</button>}
      <div className="fila" style={{ marginTop: '.6rem', alignItems: 'flex-end' }}>
        <div className="campo" style={{ marginBottom: 0 }}><label>O escribe el código</label><input className="mono" value={codigo} placeholder="BC-W-0100000001 o el número impreso" onChange={(e) => setCodigo(e.target.value.toUpperCase())} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); asignar(codigo); } }} /></div>
        <button type="button" className="primario" style={{ flex: '0 0 auto' }} disabled={!codigo || ocupado} onClick={() => asignar(codigo)}>Asignar</button>
      </div>
      {aviso && (
        <div className={`alerta ${aviso.t}`} style={{ marginTop: '.6rem' }}>
          {aviso.m}
          {aviso.forzar && <div className="acciones" style={{ marginTop: '.4rem' }}>
            <button type="button" className="primario chico" disabled={ocupado} onClick={() => asignar(aviso.forzar!, true)}>Sí, asignar {aviso.forzar}</button>
            <button type="button" className="chico" onClick={() => setAviso(null)}>Cancelar</button>
          </div>}
        </div>
      )}
    </section>
  );
}
