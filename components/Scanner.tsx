'use client';
import { useEffect, useRef, useState } from 'react';

type Props = {
  onScan: (texto: string) => void;
  pausado?: boolean;
  alto?: number;
};

/** Lector QR con la cámara trasera. Ignora la misma lectura repetida durante 2,5 s. */
export default function Scanner({ onScan, pausado = false, alto = 260 }: Props) {
  const idRef = useRef('qr-' + Math.random().toString(36).slice(2));
  const lectorRef = useRef<any>(null);
  const ultimoRef = useRef<{ t: string; ts: number }>({ t: '', ts: 0 });
  const cbRef = useRef(onScan);
  const pausaRef = useRef(pausado);
  const [error, setError] = useState('');
  const [linterna, setLinterna] = useState(false);
  cbRef.current = onScan;
  pausaRef.current = pausado;

  useEffect(() => {
    let vivo = true;
    (async () => {
      const { Html5Qrcode, Html5QrcodeSupportedFormats } = await import('html5-qrcode');
      if (!vivo) return;
      const lector = new Html5Qrcode(idRef.current, {
        formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE, Html5QrcodeSupportedFormats.CODE_128, Html5QrcodeSupportedFormats.PDF_417],
        useBarCodeDetectorIfSupported: true,
        verbose: false,
      } as any);
      lectorRef.current = lector;
      try {
        await lector.start(
          { facingMode: 'environment' },
          { fps: 12, qrbox: (w: number, h: number) => { const s = Math.floor(Math.min(w, h) * 0.75); return { width: s, height: s }; } },
          (texto: string) => {
            if (pausaRef.current) return;
            const ahora = Date.now();
            if (texto === ultimoRef.current.t && ahora - ultimoRef.current.ts < 2500) return;
            ultimoRef.current = { t: texto, ts: ahora };
            cbRef.current(texto);
          },
          () => {}
        );
      } catch (e: any) {
        setError('No se pudo abrir la cámara. Revisa los permisos del navegador.');
      }
    })();
    return () => {
      vivo = false;
      const l = lectorRef.current;
      if (l) l.stop().then(() => l.clear()).catch(() => {});
    };
  }, []);

  async function toggleLinterna() {
    try {
      await lectorRef.current?.applyVideoConstraints({ advanced: [{ torch: !linterna }] } as any);
      setLinterna(!linterna);
    } catch {}
  }

  return (
    <div className="scanner" style={{ minHeight: alto }}>
      <div id={idRef.current} style={{ width: '100%' }} />
      {pausado && <div className="scanner-pausa">En pausa</div>}
      {error && <div className="alerta error">{error}</div>}
      <button type="button" className="btn-linterna" onClick={toggleLinterna} aria-label="Linterna">
        {linterna ? '🔦 Apagar' : '🔦'}
      </button>
    </div>
  );
}
