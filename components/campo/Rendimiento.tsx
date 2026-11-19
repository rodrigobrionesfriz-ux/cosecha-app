'use client';
import { useState } from 'react';
import Scanner from '@/components/Scanner';
import { supabase } from '@/lib/supabase';
import { db, vigente } from '@/lib/offline';
import { Maestros, nombreTrabajador } from '@/lib/campo';
import { beep, fechaCL, formatearRut, hoyISO, horaCorta, normalizarCodigo, num, rutDesdeQR, tipoCodigo, vibrar } from '@/lib/util';

type Linea = { fecha: string; leido_en: string; cuartel: string; envase: string; jefe: string | null; cantidad: number; kilos: number; monto: number };
type Resultado = { trabajador: any; hoy: Linea[]; semana: { fecha: string; envases: number; kilos: number; monto: number }[]; completo: boolean };

/** Consulta del rendimiento de un trabajador: hoy (todos los jefes) y últimos 7 días. */
export default function Rendimiento({ m, onCerrar }: { m: Maestros; onCerrar: () => void }) {
  const [res, setRes] = useState<Resultado | null>(null);
  const [error, setError] = useState('');
  const [cargando, setCargando] = useState(false);
  const [manual, setManual] = useState('');

  function trabajadorDesde(texto: string): any | null {
    const cod = normalizarCodigo(texto);
    if (tipoCodigo(cod) === 'W') {
      const c = m.credenciales.find((x) => x.codigo === cod);
      return c ? m.trabajadores.find((t) => t.id === c.trabajador_id) : null;
    }
    const rut = rutDesdeQR(texto);
    return rut ? m.trabajadores.find((t) => t.rut === rut) : null;
  }

  async function consultar(texto: string) {
    if (cargando) return;
    const t = trabajadorDesde(texto);
    if (!t) { setError('No encontré un trabajador con esa credencial o carnet.'); beep(false); vibrar([200, 100, 200]); return; }
    if (String(t.id).startsWith('local:')) { setError('Trabajador recién registrado en este teléfono: sincroniza primero.'); return; }
    beep(true); vibrar(60);
    setError(''); setCargando(true);
    const hoy = hoyISO();
    const desde = hoyISO(new Date(Date.now() - 6 * 86400000));
    try {
      if (!navigator.onLine) throw new Error('sin señal');
      const { data, error } = await supabase.from('v_entregas_detalle')
        .select('fecha,leido_en,cuartel,envase,jefe,cantidad,kilos_estimados,monto')
        .eq('trabajador_id', t.id).eq('estado', 'A').gte('fecha', desde).lte('fecha', hoy)
        .order('leido_en', { ascending: false });
      if (error) throw error;
      const filas: Linea[] = (data || []).map((d: any) => ({ fecha: d.fecha, leido_en: d.leido_en, cuartel: d.cuartel, envase: d.envase, jefe: d.jefe, cantidad: Number(d.cantidad), kilos: Number(d.kilos_estimados), monto: Number(d.monto) }));
      // sumar lo de este teléfono que aún no se sube
      const pend = (await db.entregas.where('trabajador_id').equals(t.id).toArray()).filter((e) => e.sync === 0 && e.fecha >= desde && vigente(e));
      pend.forEach((e) => filas.unshift({ fecha: e.fecha, leido_en: e.leido_en, cuartel: m.cuarteles.find((c) => c.id === e.cuartel_id)?.nombre ?? '', envase: m.envases.find((x) => x.id === e.envase_id)?.nombre ?? '', jefe: 'Este teléfono (por subir)', cantidad: Number(e.cantidad), kilos: Number(e.kilos_estimados), monto: 0 }));
      setRes(armar(t, filas, true));
    } catch {
      // sin señal: lo que tiene este teléfono
      const loc = (await db.entregas.where('trabajador_id').equals(t.id).toArray()).filter((e) => e.fecha >= desde && vigente(e));
      const filas: Linea[] = loc.sort((a, b) => b.leido_en.localeCompare(a.leido_en)).map((e) => ({ fecha: e.fecha, leido_en: e.leido_en, cuartel: m.cuarteles.find((c) => c.id === e.cuartel_id)?.nombre ?? '', envase: m.envases.find((x) => x.id === e.envase_id)?.nombre ?? '', jefe: null, cantidad: Number(e.cantidad), kilos: Number(e.kilos_estimados), monto: 0 }));
      setRes(armar(t, filas, false));
    }
    setCargando(false);
  }

  function armar(t: any, filas: Linea[], completo: boolean): Resultado {
    const hoy = hoyISO();
    const porDia = new Map<string, { fecha: string; envases: number; kilos: number; monto: number }>();
    filas.forEach((f) => {
      const d = porDia.get(f.fecha) || { fecha: f.fecha, envases: 0, kilos: 0, monto: 0 };
      d.envases += f.cantidad; d.kilos += f.kilos; d.monto += f.monto;
      porDia.set(f.fecha, d);
    });
    return { trabajador: t, hoy: filas.filter((f) => f.fecha === hoy), semana: [...porDia.values()].sort((a, b) => b.fecha.localeCompare(a.fecha)), completo };
  }

  const tot = res ? res.hoy.reduce((s, f) => ({ env: s.env + f.cantidad, kg: s.kg + f.kilos, $: s.$ + f.monto }), { env: 0, kg: 0, $: 0 }) : null;
  const totSemana = res ? res.semana.reduce((s, d) => s + d.envases, 0) : 0;
  const hayMonto = res?.semana.some((d) => d.monto > 0);

  return (
    <div>
      <div className="encabezado" style={{ marginBottom: '.5rem' }}>
        <h2 style={{ margin: 0 }}>Rendimiento del trabajador</h2>
        <button className="chico" onClick={onCerrar}>✕ Cerrar</button>
      </div>

      {!res && (
        <>
          <Scanner onScan={consultar} pausado={cargando} />
          <p className="muted scanner-ayuda">Lee la credencial o el carnet del trabajador.</p>
          <div className="fila" style={{ marginTop: '.4rem' }}>
            <input className="mono" placeholder="o escribe el código de credencial" value={manual} onChange={(e) => setManual(e.target.value)} />
            <button style={{ flex: '0 0 auto' }} onClick={() => consultar(manual)}>Consultar</button>
          </div>
          {cargando && <p className="muted">Consultando…</p>}
          {error && <div className="alerta error">{error}</div>}
        </>
      )}

      {res && tot && (
        <>
          <div className="resultado ok" style={{ marginTop: 0 }}>
            <div className="nombre">{nombreTrabajador(res.trabajador)}</div>
            <div className="muted">{formatearRut(res.trabajador.rut)}</div>
          </div>
          {!res.completo && <div className="alerta aviso">Sin señal: muestra solo lo registrado en este teléfono. Puede faltar lo que entregó con otros jefes.</div>}

          <div className="kpis" style={{ gridTemplateColumns: hayMonto ? 'repeat(3,1fr)' : 'repeat(2,1fr)' }}>
            <div className="kpi"><div className="v">{num(tot.env, tot.env % 1 ? 1 : 0)}</div><div className="l">Envases hoy</div></div>
            <div className="kpi"><div className="v">{num(tot.kg)}</div><div className="l">Kg est. hoy</div></div>
            {hayMonto && <div className="kpi"><div className="v">${num(tot.$)}</div><div className="l">Trato hoy</div></div>}
          </div>

          <h3>Entregas de hoy</h3>
          {!res.hoy.length && <p className="muted">Sin entregas hoy.</p>}
          <ul className="lista-entregas">
            {res.hoy.map((f, i) => (
              <li key={i}>
                <span>{horaCorta(f.leido_en)} · {f.cuartel}<br /><span className="muted">{f.jefe ?? ''}</span></span>
                <b>{num(f.cantidad, f.cantidad % 1 ? 1 : 0)}</b>
              </li>
            ))}
          </ul>

          <h3>Últimos 7 días <span className="muted">({num(totSemana)} envases)</span></h3>
          <ul className="lista-entregas">
            {res.semana.map((d) => (
              <li key={d.fecha}>
                <span>{d.fecha === hoyISO() ? 'Hoy' : fechaCL(d.fecha)}<br /><span className="muted">{num(d.kilos)} kg{hayMonto ? ` · $${num(d.monto)}` : ''}</span></span>
                <b>{num(d.envases, d.envases % 1 ? 1 : 0)}</b>
              </li>
            ))}
          </ul>
          <p className="muted" style={{ fontSize: '.8rem' }}>No incluye entregas anuladas. Los kilos son estimados según el envase.</p>

          <div className="acciones" style={{ marginTop: '.8rem' }}>
            <button className="primario grande" style={{ flex: 1 }} onClick={() => { setRes(null); setManual(''); }}>Consultar otro</button>
            <button className="grande" style={{ flex: 1 }} onClick={onCerrar}>Cerrar</button>
          </div>
        </>
      )}
    </div>
  );
}
