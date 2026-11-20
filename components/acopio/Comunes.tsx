'use client';
import { useState } from 'react';
import { num, uuid } from '@/lib/util';
import { BinActual, ESTADOS_BIN } from '@/lib/bins';

export type Msg = { t: 'ok' | 'err' | 'av'; titulo: string; detalle?: string } | null;

export function Resultado({ msg }: { msg: Msg }) {
  if (!msg) return null;
  return (
    <div className={`resultado ${msg.t}`}>
      <div className="nombre">{msg.titulo}</div>
      {msg.detalle && <div>{msg.detalle}</div>}
    </div>
  );
}

/** Ficha corta de un bin con lo que se sabe de él */
export function FichaBin({ b }: { b: BinActual }) {
  const s = b.servidor;
  return (
    <div className="tarjeta ficha-bin">
      <div className="fila-sup">
        <b className="mono">{b.codigo}</b>
        <span className="badge">{b.estado ? ESTADOS_BIN[b.estado] : 'Sin registro de campo'}</span>
      </div>
      {s && (
        <div className="muted">
          {[s.huerto, s.cuartel, s.variedad].filter(Boolean).join(' · ')}
          {s.cuadrilla || s.abierto_por_nombre ? <div>Cuadrilla: {s.cuadrilla || s.abierto_por_nombre}</div> : null}
          {Number(s.envases) > 0 && <div>{num(s.envases)} envases · {num(s.kilos)} kg estimados</div>}
        </div>
      )}
      {!s && b.estado && <div className="muted">Registrado en este teléfono, aún sin sincronizar.</div>}
    </div>
  );
}

export type ValoresCalidad = Record<string, string>;

/** Parámetros de calidad configurables (número, entero, sí/no u opción) */
export function FormCalidad({ params, valores, setValores }: { params: any[]; valores: ValoresCalidad; setValores: (v: ValoresCalidad) => void }) {
  if (!params.length) return <p className="muted">No hay parámetros de calidad configurados.</p>;
  const set = (id: string, v: string) => setValores({ ...valores, [id]: v });
  return (
    <div className="form-calidad">
      {params.map((p) => (
        <div key={p.id} className="campo">
          <label>{p.nombre}{p.unidad ? ` (${p.unidad})` : ''}{p.obligatorio ? ' *' : ''}</label>
          {p.tipo === 'si_no' ? (
            <div className="segmentado">
              {['Sí', 'No'].map((o) => <button type="button" key={o} className={valores[p.id] === o ? 'activo' : ''} onClick={() => set(p.id, o)}>{o}</button>)}
            </div>
          ) : p.tipo === 'opcion' ? (
            <select value={valores[p.id] ?? ''} onChange={(e) => set(p.id, e.target.value)}>
              <option value="">Seleccionar…</option>
              {(p.opciones || []).map((o: string) => <option key={o} value={o}>{o}</option>)}
            </select>
          ) : (
            <input type="number" inputMode="decimal" step={p.tipo === 'entero' ? 1 : 'any'} min={p.minimo ?? undefined} max={p.maximo ?? undefined}
              value={valores[p.id] ?? ''} onChange={(e) => set(p.id, e.target.value)} />
          )}
        </div>
      ))}
    </div>
  );
}

/** Valida y convierte los valores a lo que se guarda: {parametro_id: valor} */
export function validarCalidad(params: any[], valores: ValoresCalidad, exigir: boolean): { ok: boolean; error?: string; datos: Record<string, any> } {
  const datos: Record<string, any> = {};
  for (const p of params) {
    const v = (valores[p.id] ?? '').trim();
    if (!v) {
      if (exigir && p.obligatorio) return { ok: false, error: `Falta ${p.nombre}`, datos };
      continue;
    }
    if (p.tipo === 'numero' || p.tipo === 'entero') {
      const n = Number(v.replace(',', '.'));
      if (Number.isNaN(n) || (p.tipo === 'entero' && !Number.isInteger(n))) return { ok: false, error: `${p.nombre}: valor inválido`, datos };
      if (p.minimo != null && n < Number(p.minimo)) return { ok: false, error: `${p.nombre}: mínimo ${p.minimo}`, datos };
      if (p.maximo != null && n > Number(p.maximo)) return { ok: false, error: `${p.nombre}: máximo ${p.maximo}`, datos };
      datos[p.id] = n;
    } else datos[p.id] = v;
  }
  return { ok: true, datos };
}

/** Reduce una foto a 1280 px en JPEG para que suba rápido con poca señal */
async function comprimir(file: File): Promise<Blob> {
  const img = await createImageBitmap(file);
  const escala = Math.min(1, 1280 / Math.max(img.width, img.height));
  const c = document.createElement('canvas');
  c.width = Math.round(img.width * escala); c.height = Math.round(img.height * escala);
  c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
  return await new Promise((r) => c.toBlob((b) => r(b || file), 'image/jpeg', 0.72));
}

export type FotoLocal = { nombre: string; blob: Blob; url: string };

export function Fotos({ empresaId, fotos, setFotos, max = 3 }: { empresaId: string; fotos: FotoLocal[]; setFotos: (f: FotoLocal[]) => void; max?: number }) {
  const [cargando, setCargando] = useState(false);
  async function agregar(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    setCargando(true);
    try {
      const blob = await comprimir(f);
      const fecha = new Date().toISOString().slice(0, 10);
      setFotos([...fotos, { nombre: `${empresaId}/${fecha}/${uuid()}.jpg`, blob, url: URL.createObjectURL(blob) }]);
    } finally { setCargando(false); }
  }
  return (
    <div className="fotos">
      {fotos.map((f, i) => (
        <div key={f.nombre} className="foto">
          <img src={f.url} alt="" />
          <button type="button" className="chico" onClick={() => setFotos(fotos.filter((_, j) => j !== i))}>✕</button>
        </div>
      ))}
      {fotos.length < max && (
        <label className="foto agregar">
          <input type="file" accept="image/*" capture="environment" onChange={agregar} hidden />
          {cargando ? '…' : '📷 Foto'}
        </label>
      )}
    </div>
  );
}
