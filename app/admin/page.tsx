'use client';
import { useEffect, useState } from 'react';
import { agrupar, cargarEntregas, Fila } from '@/lib/reportes';
import { useTabla } from '@/lib/datos';
import { hoyISO, horaCorta, num } from '@/lib/util';

export default function Resumen() {
  const [fecha, setFecha] = useState(hoyISO());
  const [filas, setFilas] = useState<Fila[]>([]);
  const [cargando, setCargando] = useState(true);
  const huertos = useTabla<any>('huertos', 'id', 'nombre');
  const trab = useTabla<any>('trabajadores', 'id', 'rut');

  async function cargar() {
    setCargando(true);
    try { setFilas(await cargarEntregas(fecha, fecha)); } catch {}
    setCargando(false);
  }
  useEffect(() => { cargar(); const t = setInterval(cargar, 60000); return () => clearInterval(t); }, [fecha]); // eslint-disable-line

  const validas = filas.filter((f) => f.estado === 'A');
  const dupl = filas.filter((f) => f.estado === 'D');
  const porCuartel = agrupar(validas, (f) => f.huerto + f.cuartel, (f) => f.cuartel, (f) => f.huerto).sort((a, b) => b.envases - a.envases);
  const porTrab = agrupar(validas, (f) => f.trabajador_id, (f) => f.trabajador).sort((a, b) => b.envases - a.envases);
  const porJefe = agrupar(validas, (f) => f.jefe || '—', (f) => f.jefe || '—');
  const ultima = validas[validas.length - 1];
  const envases = validas.reduce((s, f) => s + Number(f.cantidad), 0);
  const kilos = validas.reduce((s, f) => s + Number(f.kilos_estimados), 0);
  const monto = validas.reduce((s, f) => s + Number(f.monto), 0);

  const sinDatos = !huertos.cargando && !huertos.filas.length;

  return (
    <div>
      <div className="encabezado">
        <h1>Resumen del día</h1>
        <div className="acciones">
          <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} style={{ width: 170 }} />
          <button onClick={cargar}>Actualizar</button>
        </div>
      </div>

      {sinDatos && (
        <div className="tarjeta">
          <h3 style={{ marginTop: 0 }}>Primeros pasos</h3>
          <ol style={{ margin: 0, paddingLeft: '1.2rem', lineHeight: 1.8 }}>
            <li>Crea huertos, variedades, cuarteles y envases en <a href="/admin/maestros/">Huertos y maestros</a>.</li>
            <li>Ajusta las reglas de captura y las tarifas en <a href="/admin/config/">Reglas y tarifas</a>.</li>
            <li>Carga trabajadores en <a href="/admin/trabajadores/">Trabajadores</a> (o se crean en terreno al asignar credencial).</li>
            <li>Genera e imprime credenciales en <a href="/admin/tarjetas/">Tarjetas QR</a>.</li>
            <li>Invita a los jefes de cuadrilla en <a href="/admin/usuarios/">Usuarios</a>; ellos instalan la app desde <b>/campo</b> en su teléfono.</li>
          </ol>
          {trab.filas.length === 0 && null}
        </div>
      )}

      <div className="kpis">
        <div className="kpi"><div className="v">{num(envases)}</div><div className="l">Envases</div></div>
        <div className="kpi"><div className="v">{num(kilos)}</div><div className="l">Kilos estimados</div></div>
        <div className="kpi"><div className="v">{num(new Set(validas.map((f) => f.trabajador_id)).size)}</div><div className="l">Trabajadores</div></div>
        <div className="kpi"><div className="v">${num(monto)}</div><div className="l">Monto a trato</div></div>
        <div className="kpi"><div className="v">{ultima ? horaCorta(ultima.leido_en) : '—'}</div><div className="l">Última lectura recibida</div></div>
      </div>

      {dupl.length > 0 && (
        <div className="alerta aviso">
          {dupl.length} lectura(s) de caja duplicada(s) quedaron fuera del total. Revísalas en <a href="/admin/reportes/">Reportes</a> → Detalle.
        </div>
      )}
      {cargando && !filas.length && <p className="muted">Cargando…</p>}

      <div className="fila" style={{ alignItems: 'flex-start' }}>
        <div style={{ flex: '1 1 380px' }}>
          <h2>Por cuartel</h2>
          <div className="tabla-wrap">
            <table>
              <thead><tr><th>Huerto</th><th>Cuartel</th><th className="n">Envases</th><th className="n">Kilos</th><th className="n">Trab.</th></tr></thead>
              <tbody>
                {!porCuartel.length && <tr><td colSpan={5} className="muted">Sin entregas.</td></tr>}
                {porCuartel.map((a) => <tr key={a.clave}><td>{a.extra}</td><td>{a.etiqueta}</td><td className="n">{num(a.envases)}</td><td className="n">{num(a.kilos)}</td><td className="n">{a.trabajadores}</td></tr>)}
              </tbody>
            </table>
          </div>
          <h2>Por jefe de cuadrilla</h2>
          <div className="tabla-wrap">
            <table>
              <thead><tr><th>Jefe</th><th className="n">Envases</th><th className="n">Trab.</th></tr></thead>
              <tbody>
                {porJefe.map((a) => <tr key={a.clave}><td>{a.etiqueta}</td><td className="n">{num(a.envases)}</td><td className="n">{a.trabajadores}</td></tr>)}
              </tbody>
            </table>
          </div>
        </div>
        <div style={{ flex: '1 1 380px' }}>
          <h2>Trabajadores</h2>
          <div className="tabla-wrap" style={{ maxHeight: 520, overflowY: 'auto' }}>
            <table>
              <thead><tr><th>#</th><th>Trabajador</th><th className="n">Envases</th><th className="n">Entregas</th><th className="n">$</th></tr></thead>
              <tbody>
                {porTrab.map((a, i) => <tr key={a.clave}><td className="muted">{i + 1}</td><td>{a.etiqueta}</td><td className="n">{num(a.envases)}</td><td className="n">{a.entregas}</td><td className="n">{num(a.monto)}</td></tr>)}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
