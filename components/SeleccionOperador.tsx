'use client';
import { useState } from 'react';
import { fijarOperador, pinCorrecto } from '@/lib/equipo';
import { beep, vibrar } from '@/lib/util';

/** Antes de trabajar, el jefe (u operador de acopio) elige su nombre y confirma con su PIN de 4 dígitos */
export default function SeleccionOperador({ operadores, rol, equipo, onListo }: {
  operadores: any[]; rol: 'jefe' | 'acopio'; equipo: string; onListo: () => void;
}) {
  const lista = operadores.filter((o) => o.activo !== false && o.rol === rol).sort((a, b) => a.nombre.localeCompare(b.nombre));
  const [sel, setSel] = useState<any | null>(null);
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [intentos, setIntentos] = useState(0);

  async function tecla(d: string) {
    if (!sel) return;
    setError('');
    const nuevo = d === '⌫' ? pin.slice(0, -1) : (pin + d).slice(0, 4);
    setPin(nuevo);
    if (nuevo.length === 4) {
      if (await pinCorrecto(sel, nuevo)) {
        beep(true); vibrar(60);
        fijarOperador({ id: sel.id, nombre: sel.nombre, rol });
        onListo();
      } else {
        beep(false); vibrar([200, 100, 200]);
        setIntentos(intentos + 1);
        setError(intentos >= 2 ? 'PIN incorrecto. Si no lo recuerdas, pide a administración que te asigne uno nuevo.' : 'PIN incorrecto');
        setPin('');
      }
    }
  }

  if (!lista.length) {
    return (
      <div className="tarjeta">
        <h2 style={{ marginTop: 0 }}>{rol === 'jefe' ? 'No hay jefes de cuadrilla' : 'No hay operadores de acopio'}</h2>
        <p>Administración debe crearlos en el panel, en <b>Usuarios</b>, con su PIN. Luego toca <b>Sincronizar</b>.</p>
      </div>
    );
  }

  if (!sel) {
    return (
      <div>
        <h2 style={{ marginTop: 0 }}>¿Quién usa el equipo hoy?</h2>
        <p className="muted" style={{ marginTop: 0 }}>{equipo} · elige tu nombre</p>
        <div className="opciones-lista">
          {lista.map((o) => (
            <button key={o.id} type="button" onClick={() => { setSel(o); setPin(''); setError(''); setIntentos(0); }}>
              👤 {o.nombre}{!o.pin_hash ? <span className="muted"> · sin PIN</span> : null}
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="pin-caja">
      <h2 style={{ marginTop: 0, textAlign: 'center' }}>{sel.nombre}</h2>
      {!sel.pin_hash ? (
        <div className="alerta aviso">Esta persona aún no tiene PIN. Pide a administración que se lo asigne en Usuarios y luego sincroniza.</div>
      ) : (
        <>
          <p className="muted" style={{ textAlign: 'center', marginTop: 0 }}>Ingresa tu PIN</p>
          <div className="pin-puntos">{[0, 1, 2, 3].map((i) => <span key={i} className={i < pin.length ? 'lleno' : ''} />)}</div>
          {error && <div className="alerta error" style={{ textAlign: 'center' }}>{error}</div>}
          <div className="pin-teclado">
            {['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'].map((d, i) => (
              d ? <button key={i} type="button" onClick={() => tecla(d)}>{d}</button> : <span key={i} />
            ))}
          </div>
        </>
      )}
      <button type="button" className="grande" style={{ marginTop: '.8rem' }} onClick={() => setSel(null)}>Elegir otro nombre</button>
    </div>
  );
}
