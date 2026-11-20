'use client';
import { useState } from 'react';
import { num } from '@/lib/util';

export type Punto = { clave: string; etiqueta: string; valor: number; detalle?: string };

/** Tarjeta de gráfico con título, subtítulo y botón para alternar a tabla */
export function TarjetaGrafico({ titulo, sub, tabla, children }: { titulo: string; sub?: string; tabla: React.ReactNode; children: React.ReactNode }) {
  const [verTabla, setVerTabla] = useState(false);
  return (
    <section className="tarjeta graf">
      <div className="graf-cab">
        <div>
          <h3>{titulo}</h3>
          {sub && <div className="muted">{sub}</div>}
        </div>
        <button className="chico no-print" onClick={() => setVerTabla(!verTabla)}>{verTabla ? 'Ver gráfico' : 'Ver tabla'}</button>
      </div>
      {verTabla ? <div className="tabla-wrap">{tabla}</div> : children}
    </section>
  );
}

function SinDatos() { return <div className="graf-vacio muted">Sin datos</div>; }

/** Barras horizontales (una serie): ranking por categoría */
export function BarrasH({ datos, unidad = '', max: maxFijo }: { datos: Punto[]; unidad?: string; max?: number }) {
  if (!datos.length) return <SinDatos />;
  const max = maxFijo ?? Math.max(...datos.map((d) => d.valor), 1);
  return (
    <div className="barras-h">
      {datos.map((d) => (
        <div key={d.clave} className="bh-fila" title={`${d.etiqueta}: ${num(d.valor)} ${unidad}${d.detalle ? ' · ' + d.detalle : ''}`}>
          <div className="bh-et">{d.etiqueta}</div>
          <div className="bh-pista"><div className="bh-barra" style={{ width: `${(d.valor / max) * 100}%` }} /></div>
          <div className="bh-v">{num(d.valor)}</div>
        </div>
      ))}
    </div>
  );
}

/** Columnas verticales (una serie) con tooltip al pasar el mouse o tocar */
export function Columnas({ datos, unidad = '', alto = 180 }: { datos: Punto[]; unidad?: string; alto?: number }) {
  const [activo, setActivo] = useState<number | null>(null);
  if (!datos.length) return <SinDatos />;
  const max = Math.max(...datos.map((d) => d.valor), 1);
  const paso = Math.max(1, Math.ceil(datos.length / 12)); // etiquetas del eje sin amontonarse
  const a = activo != null ? datos[activo] : null;
  return (
    <div className="columnas" onMouseLeave={() => setActivo(null)}>
      <div className="col-tip" style={{ visibility: a ? 'visible' : 'hidden' }}>
        {a ? <><b>{a.etiqueta}</b> · {num(a.valor)} {unidad}{a.detalle ? <span className="muted"> · {a.detalle}</span> : null}</> : '·'}
      </div>
      <div className="col-area" style={{ height: alto }}>
        {datos.map((d, i) => (
          <div key={d.clave} className={`col-celda ${activo === i ? 'activa' : ''}`} onMouseEnter={() => setActivo(i)} onClick={() => setActivo(i)}>
            <div className="col-barra" style={{ height: `${(d.valor / max) * 100}%` }} />
          </div>
        ))}
      </div>
      <div className="col-eje">
        {datos.map((d, i) => <div key={d.clave} className="col-et">{i % paso === 0 ? d.etiqueta : ''}</div>)}
      </div>
    </div>
  );
}

/** Tabla simple de puntos */
export function TablaPuntos({ datos, cab, unidad }: { datos: Punto[]; cab: string; unidad: string }) {
  return (
    <table>
      <thead><tr><th>{cab}</th><th className="n">{unidad}</th><th>Detalle</th></tr></thead>
      <tbody>
        {!datos.length && <tr><td colSpan={3} className="muted">Sin datos.</td></tr>}
        {datos.map((d) => <tr key={d.clave}><td>{d.etiqueta}</td><td className="n">{num(d.valor)}</td><td className="muted">{d.detalle || ''}</td></tr>)}
      </tbody>
    </table>
  );
}
