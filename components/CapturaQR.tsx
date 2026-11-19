'use client';
import { useEffect, useRef, useState } from 'react';
import Scanner from './Scanner';

const SEGUNDOS = 30;

/**
 * Cámara a pedido: muestra un botón "Capturar" y enciende la cámara solo al tocarlo.
 * Se apaga sola al leer un código (salvo que onScan devuelva false para seguir leyendo)
 * o después de 30 segundos sin lecturas.
 */
export default function CapturaQR({ etiqueta = 'Capturar', ayuda, onScan, alto }: {
  etiqueta?: string;
  ayuda?: string;
  onScan: (texto: string) => boolean | void | Promise<boolean | void>;
  alto?: number;
}) {
  const [abierta, setAbierta] = useState(false);
  const [resta, setResta] = useState(SEGUNDOS);
  const ocupadoRef = useRef(false);

  useEffect(() => {
    if (!abierta) return;
    setResta(SEGUNDOS);
    const t = setInterval(() => setResta((r) => {
      if (r <= 1) { setAbierta(false); return SEGUNDOS; }
      return r - 1;
    }), 1000);
    return () => clearInterval(t);
  }, [abierta]);

  async function alLeer(texto: string) {
    if (ocupadoRef.current) return;
    ocupadoRef.current = true;
    try {
      const seguir = await onScan(texto);
      if (seguir === false) setResta(SEGUNDOS); // lectura no válida: dar otros 30 s
      else setAbierta(false);
    } finally {
      ocupadoRef.current = false;
    }
  }

  if (!abierta) {
    return (
      <button type="button" className="btn-capturar" onClick={() => setAbierta(true)}>
        <span className="ico">📷</span>
        <span>{etiqueta}</span>
      </button>
    );
  }

  return (
    <div>
      <Scanner onScan={alLeer} alto={alto} />
      <div className="captura-pie">
        <span className="muted">{ayuda ?? 'Toca la imagen para enfocar'} · se apaga en {resta} s</span>
        <button type="button" className="chico" onClick={() => setAbierta(false)}>Apagar cámara</button>
      </div>
    </div>
  );
}
