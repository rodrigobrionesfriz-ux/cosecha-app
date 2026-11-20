'use client';
import { useEffect, useRef, useState } from 'react';
import CapturaQR from '@/components/CapturaQR';
import { db, EntregaLocal, idDispositivo, propia, vigente } from '@/lib/offline';
import { Config, Dia, Maestros, faltantesAdmin, faltantesDia, jornadaActual, nombreTrabajador } from '@/lib/campo';
import { beep, hablar, hoyISO, normalizarCodigo, num, rutDesdeQR, tipoCodigo, uuid, vibrar } from '@/lib/util';
import type { Perfil } from '@/lib/auth';
import { BinAbierto, envasesEnBin, estadoBin, ESTADOS_BIN, guardarBinAbierto, leerBinAbierto, registrarEvento } from '@/lib/bins';

type Paso = 'credencial' | 'cantidad' | 'caja' | 'confirmar';
type Msg = { t: 'ok' | 'err' | 'av'; titulo: string; detalle?: string } | null;

export default function Registro({ m, dia, cfg, perfil, setDia, onCambio, irA }: {
  m: Maestros; dia: Dia; cfg: Config; perfil: Perfil; setDia: (d: Dia) => void; onCambio: () => void; irA: (t: any, cod?: string) => void;
}) {
  const [paso, setPaso] = useState<Paso>('credencial');
  const [actual, setActual] = useState<{ trabajador: any; codigo: string } | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  const [hoyTrab, setHoyTrab] = useState<{ envases: number; entregas: number }>({ envases: 0, entregas: 0 });
  const [totalHoy, setTotalHoy] = useState({ envases: 0, trabajadores: 0 });
  const [manual, setManual] = useState('');
  const [cant, setCant] = useState(1);
  const posRef = useRef<{ lat: number; lng: number } | null>(null);
  const [bin, setBin] = useState<BinAbierto | null>(null);
  const [binEnv, setBinEnv] = useState(0);
  const usaBins = !!cfg.usa_bins;
  const maxBin = Number(cfg.max_envases_bin || 0);

  async function refrescarBin() {
    const b = await leerBinAbierto();
    setBin(b);
    setBinEnv(b ? await envasesEnBin(b.id) : 0);
  }
  useEffect(() => { refrescarBin(); }, [m]); // eslint-disable-line

  const falta = faltantesDia(dia, cfg, m);
  const faltaAdmin = faltantesAdmin(cfg, m);
  const envase = m.envases.find((e) => e.id === cfg.envase_id);
  const cuartel = m.cuarteles.find((c) => c.id === dia.cuartel_id);
  const calidad = m.calidades.find((c) => c.id === cfg.calidad_id);
  const jornada = jornadaActual(m, cfg);

  // GPS opcional
  useEffect(() => {
    if (!cfg.con_gps || !navigator.geolocation) return;
    const id = navigator.geolocation.watchPosition((p) => (posRef.current = { lat: p.coords.latitude, lng: p.coords.longitude }), () => {}, { enableHighAccuracy: false, maximumAge: 60000 });
    return () => navigator.geolocation.clearWatch(id);
  }, [cfg.con_gps]);

  async function refrescarTotales() {
    const hoy = (await db.entregas.where('fecha').equals(hoyISO()).toArray()).filter((e) => vigente(e) && propia(e));
    setTotalHoy({ envases: hoy.reduce((s, e) => s + Number(e.cantidad), 0), trabajadores: new Set(hoy.map((e) => e.trabajador_id)).size });
  }
  useEffect(() => { refrescarTotales(); }, [m]); // m cambia tras cada sincronización

  async function totalTrabajador(tid: string) {
    const l = await db.entregas.where('trabajador_id').equals(tid).and((e) => e.fecha === hoyISO() && vigente(e) && propia(e)).toArray();
    return { envases: l.reduce((s, e) => s + Number(e.cantidad), 0), entregas: l.length, ultima: l.map((e) => e.leido_en).sort().pop() };
  }

  function error(titulo: string, detalle?: string) {
    setMsg({ t: 'err', titulo, detalle });
    beep(false); vibrar([200, 100, 200]);
  }

  async function leerCredencial(codigo: string, forzar = false) {
    const cred = m.credenciales.find((c) => c.codigo === codigo);
    if (!cred) {
      error('Credencial sin asignar', 'Asígnala a un trabajador en la pestaña Credencial.');
      return;
    }
    const t = m.trabajadores.find((x) => x.id === cred.trabajador_id);
    if (!t) { error('Trabajador no encontrado', 'Sincroniza para actualizar los datos.'); return; }
    if (t.estado === 'B') { error('Trabajador bloqueado', `${nombreTrabajador(t)}. Enviar a administración.`); return; }
    const tot = await totalTrabajador(t.id);
    setHoyTrab(tot);
    setActual({ trabajador: t, codigo });
    // antirebote: la misma persona leída hace muy poco
    if (!forzar && tot.ultima && cfg.segundos_entre_lecturas > 0 && Date.now() - new Date(tot.ultima).getTime() < cfg.segundos_entre_lecturas * 1000) {
      setMsg({ t: 'av', titulo: nombreTrabajador(t), detalle: 'Recién registrado. ¿Es una entrega nueva?' });
      beep(false); vibrar(300);
      setPaso('confirmar');
      return;
    }
    beep(true); vibrar(60);
    setMsg({ t: 'ok', titulo: nombreTrabajador(t), detalle: `Lleva ${num(tot.envases)} ${envase?.nombre?.toLowerCase() ?? 'envases'} hoy` });
    setCant(1);
    setPaso(cfg.modo_captura === 'credencial_caja' ? 'caja' : 'cantidad');
  }

  async function onScan(texto: string): Promise<boolean | void> {
    if (falta.length || faltaAdmin.length) return;
    const codigo = normalizarCodigo(texto);
    const tipo = tipoCodigo(codigo);
    if (tipo === 'L') return error(bin ? 'Ya tienes un bin abierto' : 'Etiqueta de bin', bin ? `Cierra ${bin.codigo} antes de abrir otro.` : 'Usa el botón Capturar bin.');
    // Respaldo: carnet del trabajador en vez de la credencial
    if (!tipo && (paso === 'credencial' || paso === 'confirmar' || paso === 'caja')) {
      const rut = rutDesdeQR(texto);
      if (rut) {
        const t = m.trabajadores.find((x) => x.rut === rut);
        const cred = t && m.credenciales.find((c) => c.trabajador_id === t.id);
        if (cred) return leerCredencial(cred.codigo);
        return error(t ? 'Trabajador sin credencial' : 'Trabajador no registrado', 'Asígnale una credencial en la pestaña Credencial.');
      }
    }
    if (paso === 'credencial' || paso === 'confirmar') {
      if (tipo === 'W') return leerCredencial(codigo);
      if (tipo === 'B') return error('Primero la credencial', 'Lee la credencial del trabajador antes de la caja.');
      error('Código no reconocido', codigo.slice(0, 40));
      return false; // seguir con la cámara encendida
    }
    if (paso === 'caja') {
      if (tipo === 'W') return leerCredencial(codigo); // cambio de trabajador
      if (tipo !== 'B') { error('No es una etiqueta de caja', codigo.slice(0, 40)); return false; }
      // caja ya leída (en este teléfono o en el servidor) dentro de la ventana de bloqueo
      const limite = Date.now() - cfg.horas_bloqueo_caja * 3600 * 1000;
      const local = (await db.entregas.where('codigo_caja').equals(codigo).toArray()).filter(vigente);
      const usada = local.some((e) => new Date(e.leido_en).getTime() > limite) ||
        m.cajas_servidor.some((c) => c.codigo_caja === codigo && new Date(c.leido_en).getTime() > limite);
      if (usada) return error('Caja ya registrada', `${codigo} se leyó en las últimas ${cfg.horas_bloqueo_caja} h.`);
      await guardar(1, codigo);
    }
  }

  async function abrirBin(texto: string): Promise<boolean | void> {
    const codigo = normalizarCodigo(texto);
    if (tipoCodigo(codigo) !== 'L') { error('No es una etiqueta de bin', codigo.slice(0, 40)); return false; }
    const est = await estadoBin(codigo);
    if (est.estado) {
      const propio = est.estado === 'abierto' && est.abierto_por === perfil.user_id;
      return error(propio ? 'Ese bin ya lo tienes abierto' : 'Bin en uso', `${codigo} · ${ESTADOS_BIN[est.estado] ?? est.estado}${est.servidor?.abierto_por_nombre ? ' por ' + est.servidor.abierto_por_nombre : ''}`);
    }
    const id = uuid();
    await registrarEvento('abrir', codigo, {
      huerto_id: dia.huerto_id, cuartel_id: dia.cuartel_id, variedad_id: cuartel?.variedad_id ?? null,
      envase_id: cfg.envase_id, cuadrilla_id: dia.cuadrilla_id ?? null,
      lat: posRef.current?.lat ?? null, lng: posRef.current?.lng ?? null,
    }, id);
    const b: BinAbierto = { id, codigo, abierto_en: new Date().toISOString(), huerto_id: dia.huerto_id!, cuartel_id: dia.cuartel_id! };
    await guardarBinAbierto(b);
    setBin(b); setBinEnv(0);
    beep(true); vibrar(80);
    setMsg({ t: 'ok', titulo: 'Bin abierto', detalle: `${codigo}${maxBin ? ` · hasta ${maxBin} envases` : ''}` });
    hablar('Bin abierto');
    onCambio();
  }

  async function cerrarBin(auto = false) {
    if (!bin) return;
    if (!auto && !confirm(`¿Cerrar el bin ${bin.codigo} con ${num(binEnv)} envases?`)) return;
    await registrarEvento('cerrar', bin.codigo, {}, bin.id);
    await guardarBinAbierto(null);
    const cod = bin.codigo;
    setBin(null); setBinEnv(0);
    setPaso('credencial'); setActual(null);
    setMsg({ t: auto ? 'av' : 'ok', titulo: auto ? 'Bin lleno y cerrado' : 'Bin cerrado', detalle: `${cod} · captura el QR del siguiente bin` });
    hablar(auto ? 'Bin lleno' : 'Bin cerrado');
    onCambio();
  }

  async function guardar(cantidad: number, codigoCaja: string | null = null) {
    if (!actual) return;
    const t = actual.trabajador;
    const ahora = new Date();
    const e: EntregaLocal = {
      id: uuid(),
      empresa_id: perfil.empresa_id,
      huerto_id: dia.huerto_id!,
      cuartel_id: dia.cuartel_id!,
      variedad_id: cuartel?.variedad_id ?? null,
      envase_id: cfg.envase_id!,
      calidad_id: cfg.calidad_id ?? null,
      turno_id: jornadaActual(m, cfg, ahora).id,
      contratista_id: dia.contratista_id ?? t.contratista_id ?? null,
      cuadrilla_id: dia.cuadrilla_id ?? null,
      trabajador_id: t.id,
      codigo_credencial: actual.codigo,
      codigo_caja: codigoCaja,
      cantidad,
      kilos_estimados: Math.round(cantidad * Number(envase?.kilos_referencia || 0) * 1000) / 1000,
      leido_en: ahora.toISOString(),
      fecha: hoyISO(ahora),
      lat: posRef.current?.lat ?? null,
      lng: posRef.current?.lng ?? null,
      dispositivo: idDispositivo(),
      jefe_user_id: perfil.user_id,
      bin_id: usaBins ? bin?.id ?? null : null,
      trabajador_nombre: nombreTrabajador(t),
      sync: 0,
    };
    await db.entregas.add(e);
    const tot = await totalTrabajador(t.id);
    setHoyTrab(tot);
    beep(true); vibrar(80);
    const nombre = nombreTrabajador(t);
    setMsg({ t: 'ok', titulo: `✔ ${nombre}`, detalle: `+${cantidad} · Total hoy: ${num(tot.envases)}` });
    hablar(`${t.nombres?.split(' ')[0] ?? ''}, ${num(tot.envases)}`);
    refrescarTotales();
    onCambio();
    if (cfg.modo_captura === 'credencial_cantidad') { setPaso('credencial'); setActual(null); }
    if (usaBins && bin) {
      const n = await envasesEnBin(bin.id);
      setBinEnv(n);
      if (maxBin > 0 && n >= maxBin) await cerrarBin(true);
    }
  }

  async function deshacer() {
    const ult = (await db.entregas.where('fecha').equals(hoyISO()).reverse().sortBy('leido_en')).filter((e) => vigente(e) && propia(e));
    const u = ult[0];
    if (!u) return;
    if (u.sync === 1) { alert('La última entrega ya se subió. Pide al administrador que la anule.'); return; }
    if (!confirm(`¿Borrar la última entrega de ${u.trabajador_nombre} (${u.cantidad})?`)) return;
    await db.entregas.delete(u.id);
    setMsg({ t: 'av', titulo: 'Entrega borrada', detalle: u.trabajador_nombre });
    refrescarTotales(); onCambio();
  }

  function cancelar() { setPaso('credencial'); setActual(null); setMsg(null); }

  if (faltaAdmin.length && !falta.length) {
    return (
      <div className="alerta error">
        El administrador aún no define <b>{faltaAdmin.join(' y ')}</b> para este huerto. Avísale y luego toca Sincronizar.
      </div>
    );
  }

  if (falta.length) {
    return (
      <div>
        <div className="alerta aviso">Antes de registrar, configura: <b>{falta.join(', ')}</b>.</div>
        <button className="primario grande" onClick={() => irA('dia')}>Configurar el día</button>
      </div>
    );
  }

  const restanBin = usaBins && maxBin > 0 ? Math.max(1, maxBin - binEnv) : Infinity;
  const max = Math.max(1, Math.min(cfg.max_cajas_por_lectura || 10, 50, restanBin));

  return (
    <div>
      <div className="contexto">
        <span>{envase?.nombre}{calidad ? ` · ${calidad.nombre}` : ''} · {jornada.nombre.replace(/^jornada\s+/i, '')}</span>
        <span><b>{num(totalHoy.envases)}</b> hoy · {totalHoy.trabajadores} trab.</span>
      </div>


      {usaBins && bin && (
        <div className="bin-barra">
          <div>
            <div className="muted">Bin abierto</div>
            <b className="mono">{bin.codigo.slice(-6)}</b>
          </div>
          <div className="bin-n">
            <b>{num(binEnv)}</b>{maxBin ? <span className="muted"> / {maxBin}</span> : null}
            {maxBin > 0 && <div className="bin-pista"><div style={{ width: `${Math.min(100, (binEnv / maxBin) * 100)}%` }} /></div>}
          </div>
          <button type="button" className="chico" onClick={() => cerrarBin(false)}>Cerrar bin</button>
        </div>
      )}

      {usaBins && !bin && (
        <div>
          <div className="alerta aviso">Para registrar, primero captura el QR del bin que va a llenar la cuadrilla.</div>
          <CapturaQR etiqueta="Capturar bin" onScan={abrirBin} />
          {msg && <div className={`resultado ${msg.t}`}><div className="nombre">{msg.titulo}</div>{msg.detalle && <div>{msg.detalle}</div>}</div>}
        </div>
      )}

      {/* La cámara se enciende solo al tocar Capturar y se apaga al leer */}
      {(!usaBins || bin) && (paso === 'credencial' || paso === 'caja') && (
        <CapturaQR key={paso + (actual?.codigo ?? '')}
          etiqueta={paso === 'caja' ? 'Capturar caja' : 'Capturar credencial'}
          onScan={onScan} />
      )}

      <p className="muted" style={{ textAlign: 'center', margin: '.5rem 0' }}>
        {paso === 'credencial' && !msg && 'Toca Capturar y apunta a la credencial (o al carnet) del trabajador'}
        {paso === 'caja' && actual && `Cajas de ${nombreTrabajador(actual.trabajador)} · una credencial distinta cambia de trabajador`}
      </p>

      {msg && (!usaBins || bin) && (
        <div className={`resultado ${msg.t}`}>
          <div className="nombre">{msg.titulo}</div>
          {msg.detalle && <div>{msg.detalle}</div>}
          {msg.titulo === 'Credencial sin asignar' && <button className="chico" style={{ marginTop: '.5rem' }} onClick={() => irA('credencial')}>Ir a asignar</button>}
        </div>
      )}

      {paso === 'confirmar' && actual && (
        <div className="acciones">
          <button className="primario grande" style={{ flex: 1 }} onClick={() => leerCredencial(actual.codigo, true)}>Sí, nueva entrega</button>
          <button className="grande" style={{ flex: 1 }} onClick={cancelar}>No</button>
        </div>
      )}

      {paso === 'cantidad' && actual && (
        <div>
          <div className="contador">
            <button type="button" aria-label="Disminuir" disabled={cant <= 1} onClick={() => { setCant(Math.max(1, cant - 1)); vibrar(20); }}>−</button>
            <div className="valor">
              <div className="n">{cant}</div>
              <div className="u">{envase?.nombre?.toLowerCase() ?? 'envases'}</div>
            </div>
            <button type="button" aria-label="Aumentar" disabled={cant >= max} onClick={() => { setCant(Math.min(max, cant + 1)); vibrar(20); }}>+</button>
          </div>
          <button className="primario grande" style={{ fontSize: '1.3rem', padding: '1.1rem' }} onClick={() => guardar(cant)}>
            Aceptar {cant}
          </button>
          <button className="grande" style={{ marginTop: '.6rem' }} onClick={cancelar}>Cancelar</button>
        </div>
      )}

      {paso === 'caja' && <button className="grande" onClick={cancelar} style={{ marginTop: '.4rem' }}>Terminar con este trabajador</button>}

      {paso === 'credencial' && (
        <details style={{ marginTop: '1rem' }}>
          <summary className="muted">Opciones</summary>
          <div className="fila" style={{ marginTop: '.6rem' }}>
            <input placeholder="Escribir código de credencial" value={manual} onChange={(e) => setManual(e.target.value)} className="mono" />
            <button style={{ flex: '0 0 auto' }} onClick={() => { onScan(manual); setManual(''); }}>OK</button>
          </div>
          <button className="peligro" style={{ marginTop: '.6rem' }} onClick={deshacer}>Deshacer última entrega</button>
        </details>
      )}
    </div>
  );
}
