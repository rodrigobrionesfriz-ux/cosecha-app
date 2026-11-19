'use client';
import { useEffect, useRef, useState } from 'react';

type Props = {
  onScan: (texto: string) => void;
  pausado?: boolean;
  oculto?: boolean;
  alto?: number;
};

type Cam = { id: string; label: string };

const CAM_KEY = 'cosecha-camara';
const ESTADO = { NO_INICIADO: 1, ESCANEANDO: 2, PAUSADO: 3 };

// Lista de cámaras: se pide una sola vez por sesión (cada consulta abre la cámara un instante)
let camarasCache: Cam[] | null = null;
// Un solo lector activo a la vez: si se monta otro, espera a que el anterior suelte la cámara
let liberacionPendiente: Promise<void> = Promise.resolve();

function elegirTrasera(cams: Cam[]): Cam | undefined {
  const traseras = cams.filter((c) => /back|rear|trasera|environment|posterior/i.test(c.label));
  const lista = traseras.length ? traseras : cams;
  return lista.find((c) => /\b0\b/.test(c.label)) || lista[0];
}
const esFrontal = (c: Cam) => /front|frontal|user|delantera/i.test(c.label);

/**
 * Lector QR con la cámara trasera.
 * La cámara se abre una vez y se pausa/reanuda (no se cierra y reabre en cada paso),
 * lo que evita que Chrome se quede sin memoria y cierre la página.
 */
export default function Scanner({ onScan, pausado = false, oculto = false, alto = 230 }: Props) {
  const idRef = useRef('qr-' + Math.random().toString(36).slice(2));
  const lectorRef = useRef<any>(null);
  const listoRef = useRef(false);
  const ultimoRef = useRef<{ t: string; ts: number }>({ t: '', ts: 0 });
  const cbRef = useRef(onScan);
  const pausaRef = useRef(pausado);
  const [error, setError] = useState('');
  const [linterna, setLinterna] = useState(false);
  const [camaras, setCamaras] = useState<Cam[]>(camarasCache || []);
  const [camId, setCamId] = useState<string | null>(null);
  const [zoomCap, setZoomCap] = useState<{ min: number; max: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [enfocando, setEnfocando] = useState(false);
  cbRef.current = onScan;
  pausaRef.current = pausado;

  // 1) Elegir cámara
  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        if (!camarasCache) {
          const { Html5Qrcode } = await import('html5-qrcode');
          await liberacionPendiente;
          camarasCache = await Html5Qrcode.getCameras();
        }
        if (!vivo) return;
        setCamaras(camarasCache!);
        const guardada = localStorage.getItem(CAM_KEY);
        const elegida = camarasCache!.find((c) => c.id === guardada) || elegirTrasera(camarasCache!);
        setCamId(elegida?.id ?? 'environment');
      } catch {
        if (vivo) setCamId('environment');
      }
    })();
    return () => { vivo = false; };
  }, []);

  // 2) Abrir la cámara (una vez por cámara elegida)
  useEffect(() => {
    if (!camId) return;
    let vivo = true;
    setError('');
    listoRef.current = false;

    const arranque = (async () => {
      await liberacionPendiente; // esperar a que otro lector haya soltado la cámara
      if (!vivo) return;
      const { Html5Qrcode, Html5QrcodeSupportedFormats } = await import('html5-qrcode');
      if (!vivo) return;
      const lector = new Html5Qrcode(idRef.current, {
        formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE, Html5QrcodeSupportedFormats.PDF_417, Html5QrcodeSupportedFormats.CODE_128],
        experimentalFeatures: { useBarCodeDetectorIfSupported: true },
        verbose: false,
      } as any);
      lectorRef.current = lector;
      const alLeer = (texto: string) => {
        if (pausaRef.current) return;
        const ahora = Date.now();
        if (texto === ultimoRef.current.t && ahora - ultimoRef.current.ts < 2500) return;
        ultimoRef.current = { t: texto, ts: ahora };
        cbRef.current(texto);
      };
      const destino = camId === 'environment' ? { facingMode: 'environment' } : camId;
      const base: MediaTrackConstraints = camId === 'environment' ? { facingMode: { ideal: 'environment' } } : { deviceId: { exact: camId } };
      try {
        await lector.start(destino, {
          fps: 12,
          videoConstraints: { ...base, width: { ideal: 1280 }, height: { ideal: 720 }, advanced: [{ focusMode: 'continuous' } as any] },
        } as any, alLeer, () => {});
      } catch {
        try { await lector.start(destino, { fps: 10 } as any, alLeer, () => {}); }
        catch { if (vivo) setError('No se pudo abrir la cámara. Revisa que el navegador tenga permiso de cámara.'); return; }
      }
      listoRef.current = true;
      if (!vivo) return;
      if (pausaRef.current) { try { lector.pause(true); } catch {} }
      try {
        const cap: any = lector.getRunningTrackCapabilities?.() || {};
        if (Array.isArray(cap.focusMode) && cap.focusMode.includes('continuous')) {
          await lector.applyVideoConstraints({ advanced: [{ focusMode: 'continuous' }] } as any);
        }
        setZoomCap(cap.zoom && cap.zoom.max > 1 ? { min: cap.zoom.min || 1, max: Math.min(cap.zoom.max, 5) } : null);
        setZoom(1);
      } catch {}
    })();

    return () => {
      vivo = false;
      // Cerrar solo cuando el arranque terminó; los siguientes lectores esperan esta promesa
      liberacionPendiente = arranque.then(async () => {
        const l = lectorRef.current;
        lectorRef.current = null;
        listoRef.current = false;
        if (!l) return;
        try {
          const st = l.getState?.();
          if (st === ESTADO.ESCANEANDO || st === ESTADO.PAUSADO) await l.stop();
          l.clear();
        } catch {}
      }).catch(() => {});
    };
  }, [camId]);

  // 3) Pausar / reanudar sin cerrar la cámara
  useEffect(() => {
    const l = lectorRef.current;
    if (!l || !listoRef.current) return;
    try {
      const st = l.getState?.();
      if (pausado && st === ESTADO.ESCANEANDO) l.pause(true);
      if (!pausado && st === ESTADO.PAUSADO) l.resume();
    } catch {}
  }, [pausado]);

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

  async function reenfocar() {
    const l = lectorRef.current;
    if (!l || !listoRef.current || pausaRef.current) return;
    setEnfocando(true);
    try {
      await l.applyVideoConstraints({ advanced: [{ focusMode: 'single-shot' }] } as any);
      setTimeout(() => { lectorRef.current?.applyVideoConstraints({ advanced: [{ focusMode: 'continuous' }] } as any).catch(() => {}); }, 800);
    } catch {}
    setTimeout(() => setEnfocando(false), 700);
  }

  function cambiarCamara() {
    const traseras = camaras.filter((c) => !esFrontal(c));
    const lista = traseras.length > 1 ? traseras : camaras;
    if (lista.length < 2) return;
    const i = lista.findIndex((c) => c.id === camId);
    const sig = lista[(i + 1) % lista.length];
    localStorage.setItem(CAM_KEY, sig.id);
    setLinterna(false);
    setCamId(sig.id);
  }

  const pasosZoom = zoomCap ? [1, 2, 3].filter((z) => z >= zoomCap.min && z <= zoomCap.max) : [];
  const nCam = camaras.filter((c) => !esFrontal(c)).length;

  return (
    <div className="scanner" style={{ height: alto, display: oculto ? 'none' : undefined }} onClick={reenfocar}>
      <div id={idRef.current} className="scanner-video" />
      {!pausado && <div className="scanner-marco" aria-hidden />}
      {enfocando && <div className="scanner-foco">Enfocando…</div>}
      {pausado && !oculto && <div className="scanner-pausa">En pausa</div>}
      {error && <div className="alerta error">{error}</div>}
      <div className="scanner-botones" onClick={(e) => e.stopPropagation()}>
        {nCam > 1 && <button type="button" onClick={cambiarCamara} aria-label="Cambiar cámara">🔄</button>}
        {pasosZoom.length > 1 && pasosZoom.map((z) => (
          <button type="button" key={z} className={zoom === z ? 'sel' : ''} onClick={() => aplicarZoom(z)}>{z}×</button>
        ))}
        <button type="button" className={linterna ? 'sel' : ''} onClick={toggleLinterna} aria-label="Linterna">🔦</button>
      </div>
    </div>
  );
}
