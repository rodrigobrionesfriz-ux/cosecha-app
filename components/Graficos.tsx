'use client';
import { useState } from 'react';
import { num } from '@/lib/util';

export type Punto = { clave: string; etiqueta: string; valor: number; detalle?: string; color?: string };

/** Paleta categórica QSecha (validada para daltonismo sobre el fondo de tarjeta).
 *  El orden es fijo: cereza, azul, trigo, hoja, violeta, turquesa, naranja, magenta. */
export const PALETA = ['var(--s1)', 'var(--s2)', 'var(--s3)', 'var(--s4)', 'var(--s5)', 'var(--s6)', 'var(--s7)', 'var(--s8)'];

/** Asigna un color estable a cada entidad (orden alfabético, no por ranking),
 *  así un contratista o variedad conserva su color aunque cambie de posición. */
export function asignarColores(claves: string[], desde = 0): Record<string, string> {
  const unicas = [...new Set(claves)].sort((a, b) => a.localeCompare(b));
  // 'desde' varía el color inicial entre gráficos; si no caben, parte del primero (sin dar la vuelta a la paleta)
  const ini = unicas.length + desde <= PALETA.length ? desde : 0;
  return Object.fromEntries(unicas.map((c, i) => [c, PALETA[(ini + i) % PALETA.length]]));
}

/** Leyenda de colores */
export function Leyenda({ items }: { items: { nombre: string; color: string }[] }) {
  if (items.length < 2) return null;
  return (
    <div className="leyenda">
      {items.map((it) => <span key={it.nombre}><i style={{ background: it.color }} />{it.nombre}</span>)}
    </div>
  );
}

/** Tarjeta de gráfico con título, subtítulo y botón para alternar a tabla */
export function TarjetaGrafico({ titulo, sub, tabla, children, color }: { titulo: string; sub?: string; tabla: React.ReactNode; children: React.ReactNode; color?: string }) {
  const [verTabla, setVerTabla] = useState(false);
  return (
    <section className="tarjeta graf" style={color ? ({ '--acento': color } as React.CSSProperties) : undefined}>
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
export function BarrasH({ datos, unidad = '', max: maxFijo, color = 'var(--s4)', colores }: { datos: Punto[]; unidad?: string; max?: number; color?: string; colores?: Record<string, string> }) {
  if (!datos.length) return <SinDatos />;
  const max = maxFijo ?? Math.max(...datos.map((d) => d.valor), 1);
  return (
    <div className="barras-h">
      {datos.map((d) => (
        <div key={d.clave} className="bh-fila" title={`${d.etiqueta}: ${num(d.valor)} ${unidad}${d.detalle ? ' · ' + d.detalle : ''}`}>
          <div className="bh-et">{d.etiqueta}</div>
          <div className="bh-pista"><div className="bh-barra" style={{ width: `${(d.valor / max) * 100}%`, background: d.color ?? colores?.[d.clave] ?? color }} /></div>
          <div className="bh-v">{num(d.valor)}</div>
        </div>
      ))}
    </div>
  );
}

/** Columnas verticales (una serie) con tooltip al pasar el mouse o tocar */
export function Columnas({ datos, unidad = '', alto = 180, color = 'var(--s4)' }: { datos: Punto[]; unidad?: string; alto?: number; color?: string }) {
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
            <div className="col-barra" style={{ height: `${(d.valor / max) * 100}%`, background: d.color ?? color }} />
          </div>
        ))}
      </div>
      <div className="col-eje">
        {datos.map((d, i) => <div key={d.clave} className="col-et">{i % paso === 0 ? d.etiqueta : ''}</div>)}
      </div>
    </div>
  );
}

/** Columnas apiladas: una columna por día, un segmento por serie (p. ej. contratista) */
export function ColumnasApiladas({ datos, series, colores, unidad = '', alto = 180 }: {
  datos: { clave: string; etiqueta: string; total: number; por: Record<string, number> }[];
  series: string[]; colores: Record<string, string>; unidad?: string; alto?: number;
}) {
  const [activo, setActivo] = useState<number | null>(null);
  if (!datos.length) return <SinDatos />;
  const max = Math.max(...datos.map((d) => d.total), 1);
  const paso = Math.max(1, Math.ceil(datos.length / 12));
  const a = activo != null ? datos[activo] : null;
  return (
    <div className="columnas" onMouseLeave={() => setActivo(null)}>
      <div className="col-tip" style={{ visibility: a ? 'visible' : 'hidden' }}>
        {a ? <><b>{a.etiqueta}</b> · {num(a.total)} {unidad}<span className="muted"> · {series.filter((s) => a.por[s]).map((s) => `${s} ${a.por[s]}`).join(' · ')}</span></> : '·'}
      </div>
      <div className="col-area" style={{ height: alto }}>
        {datos.map((d, i) => (
          <div key={d.clave} className={`col-celda ${activo === i ? 'activa' : ''}`} onMouseEnter={() => setActivo(i)} onClick={() => setActivo(i)}>
            <div className="col-pila" style={{ height: `${(d.total / max) * 100}%` }}>
              {series.filter((s) => d.por[s]).map((s) => (
                <div key={s} className="col-seg" style={{ flexGrow: d.por[s], background: colores[s] }} />
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="col-eje">
        {datos.map((d, i) => <div key={d.clave} className="col-et">{i % paso === 0 ? d.etiqueta : ''}</div>)}
      </div>
      <Leyenda items={series.map((s) => ({ nombre: s, color: colores[s] }))} />
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
