'use client';
import { useEffect, useMemo, useState } from 'react';
import GenerarProformas from '@/components/GenerarProformas';
import { useAuth } from '@/lib/auth';
import { cargarTabla, useTabla } from '@/lib/datos';
import { armarInforme, calcularAjustes, excelInforme, pdfInforme, textoPacking, TITULO } from '@/lib/informeDiario';
import { cargarEntregas, Fila } from '@/lib/reportes';
import { supabase } from '@/lib/supabase';
import { fechaCL, formatearRut, hoyISO, num } from '@/lib/util';

const pesos = (n: number) => '$' + num(n);
const kg = (n: number) => num(n, 1);

export default function InformeDiario() {
  const { perfil } = useAuth();
  const esAdmin = perfil?.rol === 'admin';
  const huertos = useTabla<any>('huertos', 'id,nombre', 'nombre');
  const contratistas = useTabla<any>('contratistas', 'id,nombre,rut', 'nombre');
  const [fecha, setFecha] = useState(hoyISO());
  const [huertoId, setHuertoId] = useState('');
  const [contratista, setContratista] = useState('');
  const [filas, setFilas] = useState<Fila[]>([]);
  const [packing, setPacking] = useState<Record<string, number | null>>({}); // guardado
  const [edicion, setEdicion] = useState<Record<string, string>>({});       // lo que se escribe
  const [cargando, setCargando] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');
  const [aviso, setAviso] = useState('');
  const [abierto, setAbierto] = useState<Record<string, boolean>>({});
  const [proformas, setProformas] = useState(false);

  async function cargar() {
    setCargando(true); setError(''); setAviso('');
    try {
      const [f, p] = await Promise.all([
        cargarEntregas(fecha, fecha, huertoId || undefined),
        cargarTabla<any>('kilos_packing', 'huerto_id,kilos', (q) => q.eq('fecha', fecha)),
      ]);
      setFilas(f);
      const m: Record<string, number | null> = {};
      for (const x of p) m[x.huerto_id] = Number(x.kilos);
      setPacking(m);
      setEdicion(Object.fromEntries(Object.entries(m).map(([k, v]) => [k, v == null ? '' : String(v)])));
    } catch (e: any) { setError(e.message); }
    setCargando(false);
  }
  useEffect(() => { cargar(); }, [fecha, huertoId]); // eslint-disable-line

  const ajustes = useMemo(() => calcularAjustes(filas, packing), [filas, packing]);
  const rutContratista = useMemo(() => Object.fromEntries(contratistas.filas.map((c) => [c.id, c.rut || ''])), [contratistas.filas]);
  const opcionesContr = useMemo(() => {
    const m = new Map<string, string>();
    for (const f of filas) if (f.estado === 'A') m.set(f.contratista_id || 'propio', f.contratista || 'Propio / interno');
    return [...m.entries()].sort((a, b) => (a[0] === 'propio' ? -1 : b[0] === 'propio' ? 1 : a[1].localeCompare(b[1])));
  }, [filas]);
  const inf = useMemo(() => armarInforme(filas, {
    empresa: perfil?.empresa?.nombre || '', empresaRut: perfil?.empresa?.rut || '', fecha,
    huerto: huertoId ? (huertos.filas.find((h) => h.id === huertoId)?.nombre || '') : 'Todos',
    ajustes, rutContratista, contratista: contratista || undefined,
  }), [filas, perfil, fecha, huertoId, huertos.filas, ajustes, rutContratista, contratista]);

  const cambios = ajustes.some((a) => (edicion[a.huerto_id] ?? '') !== (packing[a.huerto_id] == null ? '' : String(packing[a.huerto_id])));

  async function guardarPacking() {
    setGuardando(true); setError(''); setAviso('');
    try {
      for (const a of ajustes) {
        const txt = (edicion[a.huerto_id] ?? '').replace(/\./g, '').replace(',', '.').trim();
        if (txt === '') {
          if (packing[a.huerto_id] != null) {
            const { error } = await supabase.from('kilos_packing').delete().eq('fecha', fecha).eq('huerto_id', a.huerto_id);
            if (error) throw error;
          }
          continue;
        }
        const kilos = Number(txt);
        if (isNaN(kilos) || kilos < 0) throw new Error(`Kilos de packing no válidos para ${a.huerto}.`);
        const { error } = await supabase.from('kilos_packing').upsert(
          { empresa_id: perfil!.empresa_id, fecha, huerto_id: a.huerto_id, kilos },
          { onConflict: 'empresa_id,fecha,huerto_id' },
        );
        if (error) throw error;
      }
      await cargar();
      setAviso('Kilos de packing guardados. El informe ya usa los kilos ajustados.');
    } catch (e: any) { setError(e.message); }
    setGuardando(false);
  }

  const hayDatos = inf.grupos.length > 0;

  return (
    <div className="informe-diario">
      <div className="encabezado">
        <h1>{TITULO}</h1>
        <div className="acciones">
          <button onClick={() => setProformas(true)}>🧾 Generar proformas</button>
          <button onClick={() => excelInforme(inf)} disabled={!hayDatos}>⬇ Excel</button>
          <button className="primario" onClick={() => pdfInforme(inf)} disabled={!hayDatos}>⬇ PDF</button>
        </div>
      </div>

      <div className="tarjeta fila">
        <div className="campo"><label>Fecha</label><input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} /></div>
        <div className="campo">
          <label>Huerto</label>
          <select value={huertoId} onChange={(e) => setHuertoId(e.target.value)}>
            <option value="">Todos</option>
            {huertos.filas.map((h) => <option key={h.id} value={h.id}>{h.nombre}</option>)}
          </select>
        </div>
        <div className="campo">
          <label>Contratista</label>
          <select value={contratista} onChange={(e) => setContratista(e.target.value)}>
            <option value="">Todos</option>
            {opcionesContr.map(([id, n]) => <option key={id} value={id}>{n}</option>)}
          </select>
        </div>
        <div className="campo" style={{ flex: '0 0 auto' }}><button onClick={cargar} disabled={cargando}>{cargando ? 'Cargando…' : 'Actualizar'}</button></div>
      </div>

      {error && <div className="alerta error">{error}</div>}
      {aviso && <div className="alerta ok">{aviso}</div>}

      {ajustes.length > 0 && (
        <section className="tarjeta">
          <h3 style={{ marginTop: 0 }}>Kilos según packing</h3>
          <p className="muted" style={{ marginTop: 0, fontSize: '.88rem' }}>
            Ingresa los kilos que informó el packing para cada huerto. Se reparten entre los totes del día en proporción a los kilos estimados. El pago no cambia, porque se paga por envase. Si dejas el campo vacío se usan los kilos estimados.
          </p>
          <div className="tabla-wrap">
            <table>
              <thead><tr><th>Huerto</th><th className="n">Totes</th><th className="n">Kilos estimados</th><th className="n">Kilos packing</th><th className="n">Factor</th><th className="n">Kg por tote</th></tr></thead>
              <tbody>
                {ajustes.map((a) => {
                  const txt = edicion[a.huerto_id] ?? '';
                  const v = Number(txt.replace(/\./g, '').replace(',', '.'));
                  const factor = txt.trim() !== '' && !isNaN(v) && a.estimado > 0 ? v / a.estimado : 1;
                  return (
                    <tr key={a.huerto_id}>
                      <td>{a.huerto}</td>
                      <td className="n">{num(a.envases)}</td>
                      <td className="n">{kg(a.estimado)}</td>
                      <td className="n">
                        {esAdmin
                          ? <input className="input-packing" inputMode="decimal" placeholder="—" value={txt} onChange={(e) => setEdicion({ ...edicion, [a.huerto_id]: e.target.value })} />
                          : (a.packing != null ? kg(a.packing) : '—')}
                      </td>
                      <td className={`n ${factor !== 1 ? (factor < 1 ? 'factor-baja' : 'factor-sube') : 'muted'}`}>{num(factor, 3)}</td>
                      <td className="n">{a.envases ? kg((a.estimado * factor) / a.envases) : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {esAdmin && (
            <div className="acciones" style={{ marginTop: '.7rem' }}>
              <button className="primario" onClick={guardarPacking} disabled={guardando || !cambios}>{guardando ? 'Guardando…' : 'Guardar kilos de packing'}</button>
              {cambios && <span className="muted" style={{ fontSize: '.85rem' }}>Hay cambios sin guardar</span>}
            </div>
          )}
        </section>
      )}

      {!cargando && !hayDatos && <div className="tarjeta muted">No hay entregas válidas para {fechaCL(fecha)}{contratista ? ' con ese contratista' : ''}.</div>}

      {hayDatos && (
        <div className="informe-hoja">
          <div className="informe-cab">
            <div>
              <div className="informe-empresa">{inf.empresa}</div>
              {inf.empresaRut && <div className="informe-sub">RUT {formatearRut(inf.empresaRut)}</div>}
            </div>
            <div style={{ textAlign: 'right' }}>
              <div className="informe-titulo">{TITULO}</div>
              <div className="informe-sub">{fechaCL(fecha)} · Huerto: {inf.huerto}</div>
            </div>
          </div>
          <p className="muted" style={{ fontSize: '.85rem', margin: '.2rem 0 1rem' }}>{textoPacking(inf)}</p>

          <div className="kpis">
            <div className="kpi acento-5"><div className="v">{num(inf.tot.trabajadores)}</div><div className="l">Trabajadores</div></div>
            <div className="kpi acento-2"><div className="v">{num(inf.tot.totes)}</div><div className="l">Totes</div></div>
            <div className="kpi acento-4"><div className="v">{kg(inf.tot.kilos)}</div><div className="l">Kilos{inf.ajustes.some((a) => a.packing != null) ? ' (packing)' : ' estimados'}</div></div>
          </div>
          <div className="kpis kpis-pago">
            <div className="kpi acento-2"><div className="v">{pesos(inf.tot.pagoTrab)}</div><div className="l">A pagar a trabajadores</div></div>
            <div className="kpi acento-7"><div className="v">{pesos(inf.tot.pagoContr)}</div><div className="l">A pagar a contratistas</div></div>
            <div className="kpi kpi-total"><div className="v">{pesos(inf.tot.total)}</div><div className="l">Total a pagar</div></div>
          </div>

          <h2>Resumen por contratista</h2>
          <div className="tabla-wrap" style={{ marginBottom: '1rem' }}>
            <table>
              <thead><tr><th>Contratista</th><th>RUT</th><th className="n">% contr.</th><th className="n">Trab.</th><th className="n">Totes</th><th className="n">Kilos</th><th className="n">Pago trabajadores</th><th className="n">Pago contratista</th><th className="n">Total</th></tr></thead>
              <tbody>
                {inf.grupos.map((g) => (
                  <tr key={g.clave}><td>{g.contratista}</td><td>{g.rut ? formatearRut(g.rut) : ''}</td><td className="n">{g.pct}</td><td className="n">{g.trabajadores.length}</td><td className="n">{num(g.totes)}</td><td className="n">{kg(g.kilos)}</td><td className="n">{pesos(g.pagoTrab)}</td><td className="n">{pesos(g.pagoContr)}</td><td className="n"><b>{pesos(g.total)}</b></td></tr>
                ))}
              </tbody>
              <tfoot><tr><td colSpan={3}>Total</td><td className="n">{inf.tot.trabajadores}</td><td className="n">{num(inf.tot.totes)}</td><td className="n">{kg(inf.tot.kilos)}</td><td className="n">{pesos(inf.tot.pagoTrab)}</td><td className="n">{pesos(inf.tot.pagoContr)}</td><td className="n">{pesos(inf.tot.total)}</td></tr></tfoot>
            </table>
          </div>
          {inf.duplicadas > 0 && <div className="alerta aviso">{inf.duplicadas} lectura(s) duplicada(s) por revisar quedaron fuera del informe. Revísalas en <a href="/admin/reportes/">Reportes</a> → Detalle.</div>}

          {inf.grupos.map((g) => (
            <section key={g.clave} className="tarjeta informe-contr">
              <div className="encabezado" style={{ marginBottom: '.6rem' }}>
                <h3 style={{ margin: 0 }}>{g.contratista}{g.rut ? <span className="muted" style={{ fontWeight: 400 }}> · RUT {formatearRut(g.rut)}</span> : null} <span className="muted" style={{ fontWeight: 400 }}>· {g.pct}</span></h3>
                <span><b>{pesos(g.total)}</b> <span className="muted">total</span></span>
              </div>

              <h4>Trabajadores</h4>
              <div className="tabla-wrap">
                <table>
                  <thead><tr><th>RUT</th><th>Trabajador</th><th className="n">Entregas</th><th className="n">Totes</th><th className="n">Kilos</th><th className="n">Pago trabajador</th><th className="n">Pago contratista</th><th className="n">Total</th></tr></thead>
                  <tbody>
                    {g.trabajadores.map((t) => (
                      <tr key={t.id}><td className="mono">{formatearRut(t.rut)}</td><td>{t.nombre}</td><td className="n">{t.entregas}</td><td className="n">{num(t.totes)}</td><td className="n">{kg(t.kilos)}</td><td className="n">{pesos(t.pagoTrab)}</td><td className="n">{pesos(t.pagoContr)}</td><td className="n"><b>{pesos(t.total)}</b></td></tr>
                    ))}
                  </tbody>
                  <tfoot><tr><td colSpan={2}>Total · {g.trabajadores.length} trabajador(es)</td><td className="n">{g.entregas.length}</td><td className="n">{num(g.totes)}</td><td className="n">{kg(g.kilos)}</td><td className="n">{pesos(g.pagoTrab)}</td><td className="n">{pesos(g.pagoContr)}</td><td className="n">{pesos(g.total)}</td></tr></tfoot>
                </table>
              </div>

              <div className="encabezado" style={{ margin: '1rem 0 .4rem' }}>
                <h4 style={{ margin: 0 }}>Detalle de entregas por tote ({g.entregas.length})</h4>
                <button className="chico" onClick={() => setAbierto({ ...abierto, [g.clave]: !abierto[g.clave] })}>{abierto[g.clave] ? 'Ocultar' : 'Ver detalle'}</button>
              </div>
              {abierto[g.clave] && (
                <div className="tabla-wrap" style={{ maxHeight: 480, overflowY: 'auto' }}>
                  <table>
                    <thead><tr><th>Hora</th><th>Trabajador</th><th>Jefe de cuadrilla</th><th>Cuartel</th><th>Variedad</th><th className="n">Cant.</th><th className="n">Kilos</th><th className="n">Pago trab.</th><th className="n">Pago contr.</th><th className="n">Total</th></tr></thead>
                    <tbody>
                      {g.entregas.map((e) => (
                        <tr key={e.id}><td>{e.hora}</td><td>{e.trabajador}</td><td>{e.jefe}</td><td>{e.cuartel}</td><td>{e.variedad}</td><td className="n">{num(e.cantidad, e.cantidad % 1 ? 1 : 0)}</td><td className="n">{kg(e.kilos)}</td><td className="n">{pesos(e.pagoTrab)}</td><td className="n">{pesos(e.pagoContr)}</td><td className="n">{pesos(e.total)}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          ))}
        </div>
      )}
      {proformas && <GenerarProformas empresa={perfil?.empresa?.nombre || ''} empresaRut={perfil?.empresa?.rut || ''} onCerrar={() => setProformas(false)} />}
    </div>
  );
}
