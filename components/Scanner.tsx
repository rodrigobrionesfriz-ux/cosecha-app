'use client';
import { useEffect, useRef, useState } from 'react';

type Props = {
  onScan: (texto: string) => void;
  pausado?: boolean;
  alto?: number;
};

type Cam = { id: string; label: string };

const CAM_KEY = 'cosecha-camara';

/** Elige la cámara trasera principal: en Android suele ser "camera2 0, facing back". La gran angular no enfoca de cerca. */
function elegirTrasera(cams: Cam[]): Cam | undefined {
  const traseras = cams.filter((c) => /back|rear|trasera|environment|posterior/i.test(c.label));
  const lista = traseras.length ? traseras : cams;
  return lista.find((c) => /\b0\b/.test(c.label)) || lista[0];
}

/**
 * Lector QR con la cámara trasera.
 * - Alta resolución + enfoque continuo (los QR del carnet son densos).
 * - Usa el lector nativo de Android (BarcodeDetector) cuando existe.
 * - Tocar la imagen reenfoca; botones de zoom y de cambio de cámara.
 * - Ignora la misma lectura repetida durante 2,5 s.
 */
export default function Scanner({ onScan, pausado = false, alto = 260 }: Props) {
  const idRef = useRef('qr-' + Math.random().toString(36).slice(2));
  const lectorRef = useRef<any>(null);
  const ultimoRef = useRef<{ t: string; ts: number }>({ t: '', ts: 0 });
  const cbRef = useRef(onScan);
  const pausaRef = useRef(pausado);
  const [error, setError] = useState('');
  const [linterna, setLinterna] = useState(false);
  const [camaras, setCamaras] = useState<Cam[]>([]);
  const [camId, setCamId] = useState<string | null>(null);
  const [zoomCap, setZoomCap] = useState<{ min: number; max: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [enfocando, setEnfocando] = useState(false);
  cbRef.current = onScan;
  pausaRef.current = pausado;

  // 1) Descubrir cámaras una sola vez
  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        const { Html5Qrcode } = await import('html5-qrcode');
        const cams: Cam[] = await Html5Qrcode.getCameras();
        if (!vivo) return;
        setCamaras(cams);
        const guardada = localStorage.getItem(CAM_KEY);
        const elegida = cams.find((c) => c.id === guardada) || elegirTrasera(cams);
        setCamId(elegida?.id ?? 'environment');
      } catch {
        if (vivo) setCamId('environment'); // sin permiso para listar: usar la trasera por defecto
      }
    })();
    return () => { vivo = false; };
  }, []);

  // 2) Iniciar la cámara elegida
  useEffect(() => {
    if (!camId) return;
    let vivo = true;
    setError('');
    (async () => {
      const { Html5Qrcode, Html5QrcodeSupportedFormats } = await import('html5-qrcode');
      if (!vivo) return;
      const lector = new Html5Qrcode(idRef.current, {
        formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE, Html5QrcodeSupportedFormats.PDF_417, Html5QrcodeSupportedFormats.CODE_128],
        experimentalFeatures: { useBarCodeDetectorIfSupported: true },
        verbose: false,
      } as any);
      lectorRef.current = lector;
      const base: MediaTrackConstraints = camId === 'environment' ? { facingMode: { ideal: 'environment' } } : { deviceId: { exact: camId } };
      try {
        await lector.start(
          camId === 'environment' ? { facingMode: 'environment' } : camId,
          {
            fps: 15,
            qrbox: (w: number, h: number) => { const s = Math.floor(Math.min(w, h) * 0.85); return { width: s, height: s }; },
            videoConstraints: { ...base, width: { ideal: 1920 }, height: { ideal: 1080 }, advanced: [{ focusMode: 'continuous' } as any] },
          } as any,
          (texto: string) => {
            if (pausaRef.current) return;
            const ahora = Date.now();
            if (texto === ultimoRef.current.t && ahora - ultimoRef.current.ts < 2500) return;
            ultimoRef.current = { t: texto, ts: ahora };
            cbRef.current(texto);
          },
          () => {}
        );
        if (!vivo) return;
        // Capacidades reales del lente: enfoque continuo y zoom
        try {
          const cap: any = lector.getRunningTrackCapabilities?.() || {};
          if (Array.isArray(cap.focusMode) && cap.focusMode.includes('continuous')) {
            await lector.applyVideoConstraints({ advanced: [{ focusMode: 'continuous' }] } as any);
          }
          if (cap.zoom && cap.zoom.max > 1) setZoomCap({ min: cap.zoom.min || 1, max: Math.min(cap.zoom.max, 5) });
          else setZoomCap(null);
          setZoom(1);
        } catch {}
      } catch (e: any) {
        // Si la resolución alta no es compatible, reintentar simple
        try {
          await lector.start(camId === 'environment' ? { facingMode: 'environment' } : camId, { fps: 12, qrbox: 260 } as any,
            (t: string) => { if (!pausaRef.current) cbRef.current(t); }, () => {});
        } catch {
          setError('No se pudo abrir la cámara. Revisa que el navegador tenga permiso de cámara.');
        }
      }
    })();
    return () => {
      vivo = false;
      const l = lectorRef.current;
      lectorRef.current = null;
      if (l) l.stop().then(() => l.clear()).catch(() => {});
    };
  }, [camId]);

  async function toggleLinterna() {
    try {
      await lectorRef.current?.applyVideoConstraints({ advanced: [{ torch: !linterna }] } as any);
      setLinterna(!linterna);
    } catch {}
  }

  async function aplicarZoom(z: number) {
    try {
      await lectorRef.current?.applyVideoConstraints({ advanced: [{ zoom: z }] } as any);
      setZoom(z);
    } catch {}
  }

  /** Tocar la imagen: fuerza un reenfoque */
  async function reenfocar() {
    const l = lectorRef.current;
    if (!l) return;
    setEnfocando(true);
    try {
      await l.applyVideoConstraints({ advanced: [{ focusMode: 'single-shot' }] } as any);
      setTimeout(() => l.applyVideoConstraints({ advanced: [{ focusMode: 'continuous' }] } as any).catch(() => {}), 800);
    } catch {}
    setTimeout(() => setEnfocando(false), 700);
  }

  function cambiarCamara() {
    const traseras = camaras.filter((c) => !/front|frontal|user|delantera/i.test(c.label));
    const lista = traseras.length > 1 ? traseras : camaras;
    if (lista.length < 2) return;
    const i = lista.findIndex((c) => c.id === camId);
    const sig = lista[(i + 1) % lista.length];
    localStorage.setItem(CAM_KEY, sig.id);
    setLinterna(false);
    setCamId(sig.id);
  }

  const pasosZoom = zoomCap ? [1, 2, 3].filter((z) => z >= zoomCap.min && z <= zoomCap.max) : [];
  const nCam = camaras.filter((c) => !/front|frontal|user|delantera/i.test(c.label)).length;

  return (
    <div className="scanner" style={{ minHeight: alto }}>
      <div id={idRef.current} style={{ width: '100%' }} onClick={reenfocar} />
      {enfocando && <div className="scanner-foco">Enfocando…</div>}
      {pausado && <div className="scanner-pausa">En pausa</div>}
      {error && <div className="alerta error">{error}</div>}
      <div className="scanner-botones">
        {nCam > 1 && <button type="button" onClick={cambiarCamara} aria-label="Cambiar cámara">🔄</button>}
        {pasosZoom.length > 1 && pasosZoom.map((z) => (
          <button type="button" key={z} className={zoom === z ? 'sel' : ''} onClick={() => aplicarZoom(z)}>{z}×</button>
        ))}
        <button type="button" className={linterna ? 'sel' : ''} onClick={toggleLinterna} aria-label="Linterna">🔦</button>
      </div>
    </div>
  );
}
