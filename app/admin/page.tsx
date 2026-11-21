'use client';
import { useEffect, useMemo, useState } from 'react';
import { cargarEntregas, Fila } from '@/lib/reportes';
import { cargarTabla, useTabla } from '@/lib/datos';
import { supabase } from '@/lib/supabase';
import { hoyISO, horaCorta, num } from '@/lib/util';
import { BarrasH, Columnas, Punto, TablaPuntos, TarjetaGrafico } from '@/components/Graficos';

type Vista = 'Diario' | 'Temporada';

/** Inicio de temporada por defecto: 1 de julio del año agrícola en curso */
function inicioTemporada(hoy: string) {
  const [a, m] = hoy.split('-').map(Number);
  return `${m >= 7 ? a : a - 1}-07-01`;
}

function horaCL(iso: string) {
  return Number(new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hour12: false, timeZone: 'America/Santiago' }).format(new Date(iso)));
}

function restarDias(iso: string, n: number) {
  const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}
const etDia = (f: string) => f.slice(8, 10) + '/' + f.slice(5, 7);

type Acum = { clave: string; etiqueta: string; envases: number; kilos: number; trab: Set<string>; monto: number };
function acumular(filas: Fila[], clave: (f: Fila) => string, etiqueta: (f: Fila) => string) {
  const m = new Map<string, Acum>();
  for (const f of filas) {
    const k = clave(f);
    let a = m.get(k);
    if (!a) { a = { clave: k, etiqueta: etiqueta(f), envases: 0, kilos: 0, trab: new Set(), monto: 0 }; m.set(k, a); }
    a.envases += Number(f.cantidad);
    a.kilos += Number(f.kilos_estimados);
    a.monto += Number(f.monto || 0); // pago al trabajador (sin recargo de contratista)
    a.trab.add(f.trabajador_id);
  }
  return [...m.values()];
}

const aPuntos = (l: Acum[], detalle: (a: Acum) => string): Punto[] =>
  l.map((a) => ({ clave: a.clave, etiqueta: a.etiqueta, valor: Math.round(a.kilos), detalle: detalle(a) }));

export default function Dashboard() {
  const hoy = hoyISO();
  const [vista, setVista] = useState<Vista>('Diario');
  const [fecha, setFecha] = useState(hoy);
  const [desde, setDesde] = useState(inicioTemporada(hoy));
  const [huertoId, setHuertoId] = useState('');
  const [especieId, setEspecieId] = useState('');
  const [variedadId, setVariedadId] = useState('');
  const [filas, setFilas] = useState<Fila[]>([]);
  const [bins, setBins] = useState<any[]>([]);
  const [porConciliar, setPorConciliar] = useState(0);
  useEffect(() => {
    supabase.from('conciliaciones_bin').select('id', { count: 'exact', head: true }).eq('estado', 'pendiente').then(({ count }) => setPorConciliar(count || 0));
  }, [filas]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState('');
  const huertos = useTabla<any>('huertos', 'id,nombre', 'nombre');
  const especies = useTabla<any>('especies', 'id,nombre', 'nombre');
  const variedades = useTabla<any>('variedades', 'id,nombre,especie_id', 'nombre');
  const variedadesF = variedades.filas.filter((v) => !especieId || v.especie_id === especieId);

  async function cargar() {
    setCargando(true);
    try {
      const ini = vista === 'Diario' ? restarDias(fecha, 6) : desde; // en diario: 7 días para tendencias
      const [f, b] = await Promise.all([
        cargarEntregas(ini, fecha, huertoId || undefined),
        cargarTabla<any>('v_bins', 'id,estado,origen,cuadrilla,abierto_por_nombre,huerto_id,especie_id,variedad_id,kilos,minutos_a_acopio', (q) => {
          let r = q.gte('fecha', ini).lte('fecha', fecha).neq('estado', 'anulado');
          if (huertoId) r = r.eq('huerto_id', huertoId);
          return r;
        }).catch(() => []),
      ]);
      setFilas(f);
      setBins(b);
      setError('');
    } catch (e: any) { setError(e.message); }
    setCargando(false);
  }
  useEffect(() => {
    cargar();
    if (vista !== 'Diario' || fecha !== hoy) return;
    const t = setInterval(cargar, 60000); // el día en curso se refresca solo
    return () => clearInterval(t);
  }, [vista, fecha, desde, huertoId]); // eslint-disable-line

  const delRango = filas.filter((f) => (!especieId || f.especie_id === especieId) && (!variedadId || f.variedad_id === variedadId));
  const delFiltro = vista === 'Diario' ? delRango.filter((f) => f.fecha === fecha) : delRango;
  const validasRango = delRango.filter((f) => f.estado === 'A');
  const validas = delFiltro.filter((f) => f.estado === 'A');
  const dupl = delFiltro.filter((f) => f.estado === 'D');

  const r = useMemo(() => {
    const envases = validas.reduce((s, f) => s + Number(f.cantidad), 0);
    const kilos = validas.reduce((s, f) => s + Number(f.kilos_estimados), 0);
    const pago = validas.reduce((s, f) => s + Number(f.monto_total ?? f.monto), 0);
    const pagoTrab = validas.reduce((s, f) => s + Number(f.monto || 0), 0);
    const recargo = validas.reduce((s, f) => s + Number(f.monto_recargo || 0), 0);
    // por contratista: base (pago a sus trabajadores), recargo y porcentajes aplicados
    const mc = new Map<string, { nombre: string; base: number; recargo: number; pcts: Set<number> }>();
    for (const f of validas) {
      if (!f.contratista_id) continue;
      const c = mc.get(f.contratista_id) || { nombre: f.contratista || 'Contratista', base: 0, recargo: 0, pcts: new Set<number>() };
      c.base += Number(f.monto || 0); c.recargo += Number(f.monto_recargo || 0);
      if (Number(f.porcentaje_contratista)) c.pcts.add(Number(f.porcentaje_contratista));
      mc.set(f.contratista_id, c);
    }
    const contratistas = [...mc.values()].sort((a, b) => b.recargo - a.recargo);
    const trabajadores = new Set(validas.map((f) => f.trabajador_id)).size;
    const jornadas = new Set(validas.map((f) => f.trabajador_id + f.fecha)).size; // trabajador-día
    const dias = new Set(validas.map((f) => f.fecha)).size;

    const porCuadrilla = acumular(validas, (f) => f.cuadrilla || f.jefe || 'Sin cuadrilla', (f) => f.cuadrilla || f.jefe || 'Sin cuadrilla')
      .sort((a, b) => b.kilos - a.kilos);
    const porCuartel = acumular(validas, (f) => f.huerto + '|' + f.cuartel + '|' + (f.variedad || ''), (f) => `${f.cuartel}${f.variedad ? ' (' + f.variedad + ')' : ''}`)
      .sort((a, b) => b.kilos - a.kilos);
    const porVariedad = acumular(validas, (f) => f.variedad || 'Sin variedad', (f) => f.variedad || 'Sin variedad').sort((a, b) => b.kilos - a.kilos);
    const porTrab = acumular(validas, (f) => f.trabajador_id, (f) => f.trabajador).sort((a, b) => b.kilos - a.kilos);

    // Por hora (diario): kilos y trabajadores distintos que entregaron en esa hora
    const horas = acumular(validas, (f) => String(horaCL(f.leido_en)).padStart(2, '0'), (f) => `${String(horaCL(f.leido_en)).padStart(2, '0')}h`)
      .sort((a, b) => a.clave.localeCompare(b.clave));
    // Por día (temporada)
    const porDia = acumular(validas, (f) => f.fecha, (f) => f.fecha.slice(8, 10) + '/' + f.fecha.slice(5, 7))
      .sort((a, b) => a.clave.localeCompare(b.clave));

    // Top 10 por trabajador: kilos por hora (primera a última lectura de cada día, mínimo 1 h) y kilos por día trabajado
    const tw = new Map<string, { nombre: string; kilos: number; dias: Map<string, { ini: number; fin: number }> }>();
    for (const f of validas) {
      const t = tw.get(f.trabajador_id) || { nombre: f.trabajador, kilos: 0, dias: new Map() };
      t.kilos += Number(f.kilos_estimados);
      const ms = new Date(f.leido_en).getTime();
      const d = t.dias.get(f.fecha) || { ini: ms, fin: ms };
      d.ini = Math.min(d.ini, ms); d.fin = Math.max(d.fin, ms);
      t.dias.set(f.fecha, d); tw.set(f.trabajador_id, t);
    }
    const tws = [...tw.entries()].map(([id, t]) => {
      const horas = [...t.dias.values()].reduce((a, d) => a + Math.max(1, (d.fin - d.ini) / 3600000), 0);
      return { id, nombre: t.nombre, kilos: t.kilos, horas, dias: t.dias.size };
    });
    const topHora = [...tws].sort((a, b) => b.kilos / b.horas - a.kilos / a.horas).slice(0, 10);
    const topDia = [...tws].sort((a, b) => b.kilos / b.dias - a.kilos / a.dias).slice(0, 10);

    return { topHora, topDia, envases, kilos, pago, pagoTrab, recargo, contratistas, trabajadores, jornadas, dias, porCuadrilla, porCuartel, porVariedad, porTrab, horas, porDia };
  }, [delFiltro]); // eslint-disable-line

  const rendimiento = r.jornadas ? r.kilos / r.jornadas : 0;
  // % de contratistas: uno solo si todos usan el mismo; si no, el efectivo sobre lo pagado a sus trabajadores
  const pcts = new Set(r.contratistas.flatMap((c) => [...c.pcts]));
  const baseContr = r.contratistas.reduce((a, c) => a + c.base, 0);
  const pctContratistas = !r.recargo ? '' : pcts.size === 1 ? `${num([...pcts][0], 1)}%` : baseContr ? `${num((r.recargo / baseContr) * 100, 1)}% prom.` : '';

  // Acopio: bins cosechados en campo vs recibidos (como "Acopio y llenado por cuadrilla" de HubCrop)
  const binsF = bins.filter((b) => (!especieId || b.especie_id === especieId || !b.especie_id) && (!variedadId || b.variedad_id === variedadId || !b.variedad_id));
  const recibido = (b: any) => !['abierto', 'cerrado'].includes(b.estado);
  const ac = {
    cosechados: binsF.filter((b) => b.origen === 'campo').length,
    armados: binsF.filter((b) => b.origen !== 'campo').length,
    recibidos: binsF.filter(recibido).length,
    pendientes: binsF.filter((b) => !recibido(b)).length,
    camara: binsF.filter((b) => b.estado === 'en_camara').length,
    despachados: binsF.filter((b) => b.estado === 'despachado').length,
    minutos: (() => { const l = binsF.map((b) => b.minutos_a_acopio).filter((x) => x != null).map(Number); return l.length ? l.reduce((a, b) => a + b, 0) / l.length : null; })(),
  };
  const porCuadrillaBins = (() => {
    const mm = new Map<string, { clave: string; etiqueta: string; total: number; recibidos: number; pendientes: number; kilos: number }>();
    for (const b of binsF) {
      const k = b.cuadrilla || b.abierto_por_nombre || (b.origen === 'campo' ? 'Sin cuadrilla' : 'Acopio');
      const a = mm.get(k) || { clave: k, etiqueta: k, total: 0, recibidos: 0, pendientes: 0, kilos: 0 };
      a.total++; if (recibido(b)) a.recibidos++; else a.pendientes++; a.kilos += Number(b.kilos || 0);
      mm.set(k, a);
    }
    return [...mm.values()].sort((a, b) => b.total - a.total);
  })();
  const pBinsCuadrilla: Punto[] = porCuadrillaBins.map((a) => ({ clave: a.clave, etiqueta: a.etiqueta, valor: a.total, detalle: `${a.recibidos} recibidos · ${a.pendientes} sin recepción` }));
  const ultima = validas[validas.length - 1];
  const sinMaestros = !huertos.cargando && !huertos.filas.length;
  const diario = vista === 'Diario';

  const detEnv = (a: Acum) => `${num(a.envases)} envases · ${a.trab.size} trab.`;
  const pCuadrilla = aPuntos(r.porCuadrilla, detEnv);
  const pCuartel = aPuntos(r.porCuartel, (a) => `${num(a.envases)} envases`);
  const pVariedad = aPuntos(r.porVariedad, (a) => `${num(a.envases)} envases`);
  const pHoraKg = aPuntos(r.horas, (a) => `${num(a.envases)} envases`);
  const pHoraTrab: Punto[] = r.horas.map((a) => ({ clave: a.clave, etiqueta: a.etiqueta, valor: a.trab.size, detalle: `${num(a.kilos)} kg` }));
  const pDia = aPuntos(r.porDia, detEnv);

  // Tendencias: en diario, los 7 días hasta la fecha; en temporada, todo el rango
  const porDiaRango = acumular(validasRango, (f) => f.fecha, (f) => etDia(f.fecha)).sort((a, b) => a.clave.localeCompare(b.clave));
  const pRend: Punto[] = porDiaRango.map((a) => ({ clave: a.clave, etiqueta: a.etiqueta, valor: Math.round(a.trab.size ? a.kilos / a.trab.size : 0), detalle: `${num(a.kilos)} kg · ${a.trab.size} trab.` }));
  const pTopHora: Punto[] = r.topHora.map((t) => ({ clave: t.id, etiqueta: t.nombre, valor: Math.round(t.kilos / t.horas), detalle: `${num(t.kilos)} kg en ${num(t.horas, 1)} h` }));
  const pTopDia: Punto[] = r.topDia.map((t) => ({ clave: t.id, etiqueta: t.nombre, valor: Math.round(t.kilos / t.dias), detalle: `${num(t.kilos)} kg en ${t.dias} día(s)` }));
  // Trabajadores cosechando por día, separados por contratista (Propio = sin contratista)
  const contrCols = [...new Set(validasRango.map((f) => f.contratista || 'Propio'))].sort((a, b) => (a === 'Propio' ? -1 : b === 'Propio' ? 1 : a.localeCompare(b)));
  const trabDia = porDiaRango.map((a) => {
    const filasDia = validasRango.filter((f) => f.fecha === a.clave);
    const por: Record<string, number> = {};
    for (const c of contrCols) por[c] = new Set(filasDia.filter((f) => (f.contratista || 'Propio') === c).map((f) => f.trabajador_id)).size;
    return { clave: a.clave, etiqueta: a.etiqueta, total: a.trab.size, por };
  });
  const pTrabDia: Punto[] = trabDia.map((d) => ({ clave: d.clave, etiqueta: d.etiqueta, valor: d.total, detalle: contrCols.filter((c) => d.por[c]).map((c) => `${c} ${d.por[c]}`).join(' · ') }));
  const rangoTxt = vista === 'Diario' ? 'Últimos 7 días hasta la fecha' : 'Temporada';

  return (
    <div className="dashboard">
      <div className="encabezado">
        <h1>Dashboard</h1>
        <div className="acciones no-print">
          <button onClick={cargar}>Actualizar</button>
          <button onClick={() => window.print()}>PDF</button>
        </div>
      </div>

      <div className="tabs no-print">
        {(['Diario', 'Temporada'] as Vista[]).map((v) => (
          <button key={v} className={vista === v ? 'activo' : ''} onClick={() => setVista(v)}>{v}</button>
        ))}
      </div>

      <div className="fila filtros">
        {!diario && <div className="campo"><label>Inicio temporada</label><input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} /></div>}
        <div className="campo"><label>{diario ? 'Fecha' : 'Hasta'}</label><input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} /></div>
        <div className="campo">
          <label>Huerto</label>
          <select value={huertoId} onChange={(e) => setHuertoId(e.target.value)}>
            <option value="">Todos</option>
            {huertos.filas.map((h) => <option key={h.id} value={h.id}>{h.nombre}</option>)}
          </select>
        </div>
        <div className="campo">
          <label>Especie</label>
          <select value={especieId} onChange={(e) => { setEspecieId(e.target.value); setVariedadId(''); }}>
            <option value="">Todas</option>
            {especies.filas.map((h) => <option key={h.id} value={h.id}>{h.nombre}</option>)}
          </select>
        </div>
        <div className="campo">
          <label>Variedad</label>
          <select value={variedadId} onChange={(e) => setVariedadId(e.target.value)}>
            <option value="">Todas</option>
            {variedadesF.map((v) => <option key={v.id} value={v.id}>{v.nombre}</option>)}
          </select>
        </div>
      </div>

      {sinMaestros && (
        <div className="tarjeta">
          <h3 style={{ marginTop: 0 }}>Primeros pasos</h3>
          <ol style={{ margin: 0, paddingLeft: '1.2rem', lineHeight: 1.8 }}>
            <li>Crea huertos, variedades, cuarteles y envases en <a href="/admin/maestros/">Huertos y maestros</a>.</li>
            <li>Ajusta las reglas de captura y las tarifas en <a href="/admin/config/">Reglas y tarifas</a>.</li>
            <li>Carga trabajadores en <a href="/admin/trabajadores/">Trabajadores</a> (o se crean en terreno al asignar credencial).</li>
            <li>Genera e imprime credenciales en <a href="/admin/tarjetas/">Tarjetas QR</a>.</li>
            <li>Invita a los jefes de cuadrilla en <a href="/admin/usuarios/">Usuarios</a>; ellos instalan la app desde <b>/campo</b> en su teléfono.</li>
          </ol>
        </div>
      )}

      {error && <div className="alerta error">{error}</div>}
      {porConciliar > 0 && (
        <div className="alerta aviso">{porConciliar} bin(s) con diferencias entre campo y acopio. Revísalos en <a href="/admin/acopio/">Acopio y bins → Conciliación</a>.</div>
      )}

      <div className="kpis">
        <div className="kpi"><div className="v">{num(r.kilos)}</div><div className="l">Kilos estimados</div></div>
        <div className="kpi"><div className="v">{num(r.envases)}</div><div className="l">Envases</div></div>
        <div className="kpi"><div className="v">{num(r.trabajadores)}</div><div className="l">Trabajadores</div></div>
        <div className="kpi"><div className="v">{num(rendimiento, 1)}</div><div className="l">Kg por trabajador{diario ? '' : ' al día'}</div></div>
        {diario
          ? <div className="kpi"><div className="v">{ultima ? horaCorta(ultima.leido_en) : '—'}</div><div className="l">Última lectura</div></div>
          : <div className="kpi"><div className="v">{r.dias}</div><div className="l">Días con cosecha</div></div>}
      </div>
      <div className="kpis kpis-pago">
        <div className="kpi"><div className="v">${num(r.pagoTrab)}</div><div className="l">A pagar a trabajadores</div></div>
        <div className="kpi" title={r.contratistas.map((c) => `${c.nombre}: ${[...c.pcts].join(' / ') || 0}% sobre $${num(c.base)} = $${num(c.recargo)}`).join('\n')}>
          <div className="v">${num(r.recargo)}</div>
          <div className="l">A pagar a contratistas{pctContratistas ? ` · ${pctContratistas}` : ''}</div>
        </div>
        <div className="kpi kpi-total"><div className="v">${num(r.pago)}</div><div className="l">Total a pagar</div></div>
      </div>

      {dupl.length > 0 && (
        <div className="alerta aviso">
          {dupl.length} lectura(s) de caja duplicada(s) quedaron fuera del total. Revísalas en <a href="/admin/reportes/">Reportes</a> → Detalle.
        </div>
      )}
      {cargando && !filas.length && <p className="muted">Cargando…</p>}

      <div className="graf-grilla">
        {diario ? (
          <>
            <TarjetaGrafico titulo="Kilos por hora" sub="Kilos estimados entregados en cada hora" tabla={<TablaPuntos datos={pHoraKg} cab="Hora" unidad="Kilos" />}>
              <Columnas datos={pHoraKg} unidad="kg" />
            </TarjetaGrafico>
            <TarjetaGrafico titulo="Trabajadores por hora" sub="Trabajadores distintos que entregaron en cada hora" tabla={<TablaPuntos datos={pHoraTrab} cab="Hora" unidad="Trabajadores" />}>
              <Columnas datos={pHoraTrab} unidad="trab." />
            </TarjetaGrafico>
          </>
        ) : (
          <TarjetaGrafico titulo="Kilos por día" sub="Avance diario de la temporada" tabla={<TablaPuntos datos={pDia} cab="Día" unidad="Kilos" />}>
            <Columnas datos={pDia} unidad="kg" />
          </TarjetaGrafico>
        )}

        <TarjetaGrafico titulo="Kilos por cuadrilla" sub="Cuadrilla o jefe que registró la entrega" tabla={<TablaPuntos datos={pCuadrilla} cab="Cuadrilla" unidad="Kilos" />}>
          <BarrasH datos={pCuadrilla} unidad="kg" />
        </TarjetaGrafico>

        <TarjetaGrafico titulo="Kilos por cuartel y variedad" sub={diario ? 'Cosechado en el día' : 'Acumulado de la temporada'} tabla={<TablaPuntos datos={pCuartel} cab="Cuartel" unidad="Kilos" />}>
          <BarrasH datos={pCuartel} unidad="kg" />
        </TarjetaGrafico>

        <TarjetaGrafico titulo="Kilos por variedad" sub={diario ? 'Cosechado en el día' : 'Acumulado de la temporada'} tabla={<TablaPuntos datos={pVariedad} cab="Variedad" unidad="Kilos" />}>
          <BarrasH datos={pVariedad} unidad="kg" />
        </TarjetaGrafico>

        <TarjetaGrafico titulo="Rendimiento diario por trabajador" sub={`Kg promedio por trabajador cada día · ${rangoTxt}`} tabla={<TablaPuntos datos={pRend} cab="Día" unidad="Kg/trabajador" />}>
          <Columnas datos={pRend} unidad="kg/trab." />
        </TarjetaGrafico>

        <TarjetaGrafico titulo="Trabajadores cosechando por día" sub={`Separados por contratista · ${rangoTxt}`}
          tabla={(
            <table>
              <thead><tr><th>Día</th>{contrCols.map((c) => <th key={c} className="n">{c}</th>)}<th className="n">Total</th></tr></thead>
              <tbody>
                {!trabDia.length && <tr><td colSpan={contrCols.length + 2} className="muted">Sin datos.</td></tr>}
                {trabDia.map((d) => <tr key={d.clave}><td>{d.etiqueta}</td>{contrCols.map((c) => <td key={c} className="n">{d.por[c] || ''}</td>)}<td className="n"><b>{d.total}</b></td></tr>)}
              </tbody>
            </table>
          )}>
          <Columnas datos={pTrabDia} unidad="trab." />
          {contrCols.length > 0 && trabDia.length > 0 && (
            <div className="muted" style={{ fontSize: '.85rem', marginTop: '.4rem' }}>
              {diario ? 'Hoy' : 'Último día'}: {contrCols.map((c) => `${c} ${trabDia[trabDia.length - 1].por[c] || 0}`).join(' · ')}
            </div>
          )}
        </TarjetaGrafico>

        <TarjetaGrafico titulo="Top 10 kilos por hora" sub="Kilos ÷ horas entre la primera y la última entrega del día (mínimo 1 h)" tabla={<TablaPuntos datos={pTopHora} cab="Trabajador" unidad="Kg/hora" />}>
          <BarrasH datos={pTopHora} unidad="kg/h" />
        </TarjetaGrafico>

        <TarjetaGrafico titulo="Top 10 kilos por día" sub={diario ? 'Kilos del trabajador en el día' : 'Kilos ÷ días trabajados en la temporada'} tabla={<TablaPuntos datos={pTopDia} cab="Trabajador" unidad="Kg/día" />}>
          <BarrasH datos={pTopDia} unidad="kg/día" />
        </TarjetaGrafico>
      </div>

      {binsF.length > 0 && (
        <>
          <h2>Acopio</h2>
          <div className="kpis">
            <div className="kpi"><div className="v">{ac.cosechados}</div><div className="l">Bins cosechados en campo</div></div>
            <div className="kpi"><div className="v">{ac.recibidos}</div><div className="l">Recibidos en acopio{ac.armados ? ` (${ac.armados} armados allí)` : ''}</div></div>
            <div className="kpi"><div className="v">{ac.pendientes}</div><div className="l">Sin recepción</div></div>
            <div className="kpi"><div className="v">{ac.camara}</div><div className="l">En cámara</div></div>
            <div className="kpi"><div className="v">{ac.despachados}</div><div className="l">Despachados</div></div>
            <div className="kpi"><div className="v">{ac.minutos == null ? '—' : num(ac.minutos)}</div><div className="l">Min. promedio de campo a acopio</div></div>
          </div>
          <div className="graf-grilla">
            <TarjetaGrafico titulo="Bins por cuadrilla" sub="Bins llenados; el detalle muestra recibidos y sin recepción"
              tabla={(
                <table>
                  <thead><tr><th>Cuadrilla</th><th className="n">Bins</th><th className="n">Recibidos</th><th className="n">Sin recepción</th><th className="n">Kilos</th></tr></thead>
                  <tbody>{porCuadrillaBins.map((a) => <tr key={a.clave}><td>{a.etiqueta}</td><td className="n">{a.total}</td><td className="n">{a.recibidos}</td><td className="n">{a.pendientes}</td><td className="n">{num(a.kilos)}</td></tr>)}</tbody>
                </table>
              )}>
              <BarrasH datos={pBinsCuadrilla} unidad="bins" />
            </TarjetaGrafico>
          </div>
          <p className="muted" style={{ marginTop: '-.4rem' }}>Detalle de cada bin en <a href="/admin/acopio/">Acopio y bins</a>.</p>
        </>
      )}

      {r.contratistas.length > 0 && (
        <>
          <h2>Pago a contratistas</h2>
          <div className="tabla-wrap" style={{ marginBottom: '1rem' }}>
            <table>
              <thead><tr><th>Contratista</th><th className="n">% asignado</th><th className="n">Pago a sus trabajadores</th><th className="n">A pagar al contratista</th><th className="n">Total</th></tr></thead>
              <tbody>
                {r.contratistas.map((c) => (
                  <tr key={c.nombre}><td>{c.nombre}</td><td className="n">{[...c.pcts].map((p) => num(p, 1) + '%').join(' / ') || '0%'}</td><td className="n">${num(c.base)}</td><td className="n"><b>${num(c.recargo)}</b></td><td className="n">${num(c.base + c.recargo)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <h2>Trabajadores</h2>
      <div className="tabla-wrap" style={{ maxHeight: 520, overflowY: 'auto' }}>
        <table>
          <thead><tr><th>#</th><th>Trabajador</th><th className="n">Envases</th><th className="n">Kilos</th><th className="n">A pagar</th></tr></thead>
          <tbody>
            {!r.porTrab.length && <tr><td colSpan={5} className="muted">Sin entregas.</td></tr>}
            {r.porTrab.map((a, i) => <tr key={a.clave}><td className="muted">{i + 1}</td><td>{a.etiqueta}</td><td className="n">{num(a.envases)}</td><td className="n">{num(a.kilos)}</td><td className="n">{num(a.monto)}</td></tr>)}
          </tbody>
        </table>
      </div>
    </div>
  );
}
