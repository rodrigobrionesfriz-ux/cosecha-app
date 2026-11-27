'use client';
import { useEffect, useState } from 'react';
import CapturaQR from '@/components/CapturaQR';
import { deshacerEvento, ESTADOS_BIN, estadoBin, registrarEvento } from '@/lib/bins';
import { db, DespachoLocal, DestinosLocales, EventoLocal, getCache, setCache, usuarioActual } from '@/lib/offline';
import { supabase } from '@/lib/supabase';
import { Maestros } from '@/lib/campo';
import { beep, hablar, horaCorta, normalizarCodigo, rutValido, tipoCodigo, uuid, vibrar } from '@/lib/util';
import type { Perfil } from '@/lib/auth';
import { Msg, Resultado } from './Comunes';

type Camion = { patente: string; transportista?: string | null; chofer?: string | null; carro?: string | null; activo?: boolean };
const NUEVO = '__nuevo__';
/** Patente en mayúsculas y sin espacios, guiones ni puntos (igual que el servidor) */
const normalizarPatente = (p: string) => p.toUpperCase().replace(/[^A-Z0-9]/g, '');

export default function Despacho({ m, perfil, onCambio }: { m: Maestros; perfil: Perfil; onCambio: () => void }) {
  const [actual, setActual] = useState<DespachoLocal | null>(null);
  const [cargados, setCargados] = useState<EventoLocal[]>([]); // movimientos 'despachar' vigentes del despacho abierto
  const bins = cargados.map((e) => e.codigo);
  const VACIO = { camion: '', patente: '', transportista: '', carro: '', guia: '', chofer: '',
    packing: '', planta: '', pk_nombre: '', pk_rut: '', pl_nombre: '', pl_direccion: '', pl_comuna: '' };
  const [form, setForm] = useState(VACIO);
  const [locales, setLocales] = useState<Camion[]>([]);
  const [destLoc, setDestLoc] = useState<DestinosLocales>({ packings: [], plantas: [] });
  const [editGuia, setEditGuia] = useState<{ id: string; valor: string } | null>(null); // ingresar o corregir la guía // agregados en este teléfono, aún no descargados
  const [msg, setMsg] = useState<Msg>(null);
  const [recientes, setRecientes] = useState<DespachoLocal[]>([]);

  async function cargar() {
    const uid = usuarioActual();
    const todos = (await db.despachos.toArray()).filter((d) => d.usuario === uid).sort((a, b) => b.abierto_en.localeCompare(a.abierto_en));
    const ab = todos.find((d) => d.estado === 'abierto') || null;
    setActual(ab);
    setRecientes(todos.filter((d) => d.estado === 'cerrado').slice(0, 5));
    if (ab) {
      const ok = (e: EventoLocal) => e.datos?.despacho_id === ab.id && (!e.resultado || e.resultado === 'OK');
      const cargas = (await db.eventos.where('tipo').equals('despachar').toArray()).filter(ok);
      const quitados = (await db.eventos.where('tipo').equals('quitar_despacho').toArray()).filter(ok);
      // un bin sigue arriba si no hay un "quitar" posterior a su carga
      setCargados(cargas.filter((c) => !quitados.some((q) => q.codigo === c.codigo && q.hecho_en > c.hecho_en))
        .sort((a, b) => a.hecho_en.localeCompare(b.hecho_en)));
    } else setCargados([]);
  }
  useEffect(() => { cargar(); }, [m]); // eslint-disable-line
  useEffect(() => { getCache<Camion[]>('camiones_locales').then((l) => setLocales(l || [])); }, [m]);
  useEffect(() => { getCache<DestinosLocales>('destinos_locales').then((l) => setDestLoc(l || { packings: [], plantas: [] })); }, [m]);

  // Destinos: packings con sus plantas (servidor + agregados en este teléfono)
  const unir = (a: any[], b: any[]) => [...a, ...b.filter((x) => !a.some((y) => y.id === x.id))];
  const packings = unir((m.packings || []).filter((x: any) => x.activo !== false), destLoc.packings)
    .sort((a, b) => (a.nombre_corto || a.nombre).localeCompare(b.nombre_corto || b.nombre));
  const plantas = unir((m.packing_plantas || []).filter((x: any) => x.activo !== false), destLoc.plantas);
  const nombrePk = (p: any) => p?.nombre_corto || p?.nombre || '';
  const pkNuevo = form.packing === NUEVO;
  const plNuevo = pkNuevo || form.planta === NUEVO;
  const plantasDe = plantas.filter((x) => x.packing_id === form.packing).sort((a, b) => a.nombre.localeCompare(b.nombre));

  function elegirPacking(v: string) {
    const pls = plantas.filter((x) => x.packing_id === v);
    setForm({ ...form, packing: v, planta: pls.length === 1 ? pls[0].id : '', pk_nombre: '', pk_rut: '', pl_nombre: '', pl_direccion: '', pl_comuna: '' });
  }

  // Camiones del servidor + los agregados aquí (sin duplicar patente), por patente
  const servidor: Camion[] = (m.camiones || []).filter((c: any) => c.activo !== false);
  const camiones: Camion[] = [...servidor, ...locales.filter((l) => !servidor.some((c) => c.patente === l.patente))]
    .sort((a, b) => a.patente.localeCompare(b.patente));
  const nuevo = form.camion === NUEVO;

  function elegir(v: string) {
    if (v === NUEVO) { setForm({ ...form, camion: v, patente: '', transportista: '', carro: '', chofer: '' }); return; }
    const c = camiones.find((x) => x.patente === v);
    setForm({ ...form, camion: v, patente: c?.patente || '', transportista: c?.transportista || '', carro: c?.carro || '', chofer: c?.chofer || '' });
  }

  function error(titulo: string, detalle?: string) { setMsg({ t: 'err', titulo, detalle }); beep(false); vibrar([200, 100, 200]); }

  async function abrir(e: React.FormEvent) {
    e.preventDefault();
    if (!form.camion) return error('Elige el camión');
    const patente = normalizarPatente(form.patente);
    if (!/^[A-Z0-9]{4,8}$/.test(patente)) return error('Patente no válida', 'Usa letras y números, ej: BBVT39');
    const carro = normalizarPatente(form.carro);
    if (carro && !/^[A-Z0-9]{4,8}$/.test(carro)) return error('Patente del carro no válida', 'Usa letras y números, ej: JK1234');
    // destino
    if (!form.packing) return error('Elige el destino (packing)');
    if (pkNuevo && !form.pk_nombre.trim()) return error('Falta la razón social del packing');
    const rutPk = form.pk_rut.replace(/[^0-9kK]/g, '').toUpperCase();
    if (pkNuevo && rutPk && !rutValido(rutPk)) return error('RUT del packing no válido');
    if (!plNuevo && !form.planta) return error('Elige la planta de destino');
    if (plNuevo && !form.pl_nombre.trim()) return error('Falta el nombre de la planta', 'Ej: Planta San Clemente');
    if (nuevo) {
      if (camiones.some((c) => c.patente === patente)) return error('Ese camión ya existe', `Elígelo en la lista: ${patente}`);
      const c: Camion = { patente, transportista: form.transportista.trim() || null, chofer: form.chofer.trim() || null, carro: carro || null };
      const l = [...locales, c];
      await setCache('camiones_locales', l); setLocales(l);
      // con señal queda registrado altiro; sin señal se registra al subir el despacho
      if (navigator.onLine) supabase.from('camiones').insert({ empresa_id: perfil.empresa_id, ...c }).then(() => {}, () => {});
    }
    let packingId = form.packing, plantaId = form.planta;
    if (plNuevo) {
      const loc: DestinosLocales = { packings: [...destLoc.packings], plantas: [...destLoc.plantas] };
      if (pkNuevo) {
        packingId = uuid();
        loc.packings.push({ id: packingId, empresa_id: perfil.empresa_id, nombre: form.pk_nombre.trim(), rut: rutPk || null, sync: 0 });
      }
      plantaId = uuid();
      loc.plantas.push({ id: plantaId, empresa_id: perfil.empresa_id, packing_id: packingId, nombre: form.pl_nombre.trim(),
        direccion: form.pl_direccion.trim() || null, comuna: form.pl_comuna.trim() || null, sync: 0 });
      await setCache('destinos_locales', loc); setDestLoc(loc);
    }
    const pk = pkNuevo ? { nombre: form.pk_nombre.trim() } : packings.find((x) => x.id === packingId);
    const pl = plNuevo ? { nombre: form.pl_nombre.trim() } : plantas.find((x) => x.id === plantaId);
    const d: DespachoLocal = {
      id: uuid(), empresa_id: perfil.empresa_id, patente, carro, packing_id: packingId, planta_id: plantaId, transportista: form.transportista.trim(), guia: form.guia.trim(),
      destino: `${nombrePk(pk)} · ${pl?.nombre || ''}`, chofer: form.chofer.trim(), estado: 'abierto', abierto_en: new Date().toISOString(),
      cerrado_en: null, usuario: usuarioActual(), sync: 0,
    };
    await db.despachos.add(d);
    setForm(VACIO);
    setMsg(null);
    await cargar(); onCambio();
  }

  async function leer(texto: string): Promise<boolean | void> {
    if (!actual) return;
    const codigo = normalizarCodigo(texto);
    if (tipoCodigo(codigo) !== 'L') { error('No es una etiqueta de bin', codigo.slice(0, 40)); return false; }
    if (bins.includes(codigo)) { error('Ya está en este camión', codigo); return false; }
    const b = await estadoBin(codigo);
    if (!b.estado || b.estado === 'abierto' || b.estado === 'cerrado') {
      error('Primero recibe el bin', `${codigo} · ${b.estado ? ESTADOS_BIN[b.estado] : 'sin registro'}`); return false;
    }
    await registrarEvento('despachar', codigo, { despacho_id: actual.id }, b.id);
    beep(true); vibrar(60);
    setMsg({ t: 'ok', titulo: `✔ Cargado (${bins.length + 1})`, detalle: codigo });
    await cargar();
    onCambio();
    return false; // seguir cargando
  }

  /** Bajar un bin del camión (despacho abierto): vuelve a quedar en acopio */
  async function quitar(e: EventoLocal, preguntar = true) {
    if (!actual) return;
    if (preguntar && !confirm(`¿Quitar el bin ${e.codigo} de este camión? Vuelve a quedar en acopio.`)) return;
    const previo = (await estadoAntes(e)) || 'recibido';
    await deshacerEvento(e, 'quitar_despacho', { despacho_id: actual.id, estado_previo: previo });
    if (preguntar) { hablar('Bin quitado'); setMsg({ t: 'ok', titulo: 'Bin quitado del camión', detalle: e.codigo }); }
    await cargar(); onCambio();
  }

  /** Estado del bin justo antes de subirlo al camión (recibido o enfriado) */
  async function estadoAntes(e: EventoLocal) {
    const prev = (await db.eventos.where('codigo').equals(e.codigo).sortBy('hecho_en')).filter((x) => x.hecho_en < e.hecho_en && (!x.resultado || x.resultado === 'OK'));
    const ult = prev[prev.length - 1];
    return ult?.tipo === 'camara_salida' ? 'enfriado' : ult?.tipo === 'camara_entrada' ? 'en_camara' : 'recibido';
  }

  /** Anular el despacho abierto: baja todos los bins y lo marca como anulado */
  async function anular() {
    if (!actual) return;
    if (!confirm(`¿Anular el despacho ${actual.patente}?${cargados.length ? ` Los ${cargados.length} bins vuelven a quedar en acopio.` : ''}`)) return;
    for (const e of cargados) await quitar(e, false);
    await db.despachos.update(actual.id, { estado: 'anulado', cerrado_en: new Date().toISOString(), sync: 0 });
    hablar('Despacho anulado');
    setMsg({ t: 'ok', titulo: 'Despacho anulado', detalle: actual.patente });
    await cargar(); onCambio();
  }

  /** Guía de despacho: se puede ingresar o corregir con el despacho abierto o ya cerrado */
  async function guardarGuia() {
    if (!editGuia) return;
    await db.despachos.update(editGuia.id, { guia: editGuia.valor.trim(), sync: 0 });
    setEditGuia(null);
    await cargar(); onCambio();
  }

  async function cerrar() {
    if (!actual) return;
    if (!bins.length && !confirm('El camión no tiene bins. ¿Cerrarlo igual?')) return;
    if (bins.length && !confirm(`¿Cerrar el despacho ${actual.patente} con ${bins.length} bins?`)) return;
    let guia = actual.guia;
    if (!guia) guia = (prompt('N° de guía de despacho (puedes dejarlo vacío e ingresarlo después):') || '').trim();
    await db.despachos.update(actual.id, { estado: 'cerrado', cerrado_en: new Date().toISOString(), guia, sync: 0 });
    hablar('Despacho cerrado');
    setMsg({ t: 'ok', titulo: 'Despacho cerrado', detalle: `${actual.patente} · ${bins.length} bins` });
    await cargar(); onCambio();
  }

  const guiaEditor = editGuia && (
    <div className="fila" style={{ alignItems: 'center', margin: '.3rem 0 .6rem' }}>
      <input inputMode="numeric" autoFocus placeholder="N° de guía" value={editGuia.valor} onChange={(e) => setEditGuia({ ...editGuia, valor: e.target.value })} style={{ flex: '1 1 140px' }} />
      <button className="primario chico" style={{ flex: '0 0 auto' }} onClick={guardarGuia}>Guardar</button>
      <button className="chico" style={{ flex: '0 0 auto' }} onClick={() => setEditGuia(null)}>Cancelar</button>
    </div>
  );

  if (!actual) {
    return (
      <div>
        <form className="tarjeta" onSubmit={abrir}>
          <h3 style={{ marginTop: 0 }}>Nuevo despacho</h3>
          <div className="campo">
            <label>Camión *</label>
            <select value={form.camion} onChange={(e) => elegir(e.target.value)} className="mono">
              <option value="">Elige el camión…</option>
              {camiones.map((c) => <option key={c.patente} value={c.patente}>{c.patente}{c.transportista ? ` · ${c.transportista}` : ''}</option>)}
              <option value={NUEVO}>+ Agregar camión nuevo</option>
            </select>
          </div>
          {nuevo && (
            <div className="tarjeta" style={{ background: 'var(--paja-3)', padding: '.8rem' }}>
              <div className="campo"><label>Patente del camión nuevo *</label>
                <input value={form.patente} onChange={(e) => setForm({ ...form, patente: e.target.value.toUpperCase() })} className="mono" placeholder="Ej: BBVT39" autoCapitalize="characters" autoFocus />
              </div>
              <div className="campo"><label>Transportista</label><input value={form.transportista} onChange={(e) => setForm({ ...form, transportista: e.target.value })} placeholder="Empresa de transporte" /></div>
              <p className="muted" style={{ margin: 0, fontSize: '.82rem' }}>Queda guardado para los próximos despachos.</p>
            </div>
          )}
          {form.camion && (
            <div className="campo"><label>Patente del carro <span className="muted" style={{ fontWeight: 400 }}>(si lleva)</span></label>
              <input value={form.carro} onChange={(e) => setForm({ ...form, carro: e.target.value.toUpperCase() })} className="mono" placeholder="Ej: JK1234" autoCapitalize="characters" />
            </div>
          )}
          <div className="campo"><label>N° guía de despacho <span className="muted" style={{ fontWeight: 400 }}>(puedes ingresarla después)</span></label><input inputMode="numeric" value={form.guia} onChange={(e) => setForm({ ...form, guia: e.target.value })} /></div>
          <div className="campo">
            <label>Destino (packing) *</label>
            <select value={form.packing} onChange={(e) => elegirPacking(e.target.value)}>
              <option value="">Elige el packing…</option>
              {packings.map((p) => <option key={p.id} value={p.id}>{nombrePk(p)}</option>)}
              <option value={NUEVO}>+ Agregar packing nuevo</option>
            </select>
          </div>
          {pkNuevo && (
            <div className="tarjeta" style={{ background: 'var(--paja-3)', padding: '.8rem' }}>
              <div className="campo"><label>Razón social del packing *</label><input value={form.pk_nombre} onChange={(e) => setForm({ ...form, pk_nombre: e.target.value })} /></div>
              <div className="campo"><label>RUT</label><input value={form.pk_rut} onChange={(e) => setForm({ ...form, pk_rut: e.target.value })} placeholder="Ej: 76.543.210-3" /></div>
              <p className="muted" style={{ margin: 0, fontSize: '.82rem' }}>El resto de la ficha se completa en el panel (Configuración → Destinos).</p>
            </div>
          )}
          {form.packing && !pkNuevo && (
            <div className="campo">
              <label>Planta *</label>
              <select value={form.planta} onChange={(e) => setForm({ ...form, planta: e.target.value })}>
                <option value="">Elige la planta…</option>
                {plantasDe.map((p) => <option key={p.id} value={p.id}>{p.nombre}{p.comuna ? ` · ${p.comuna}` : ''}</option>)}
                <option value={NUEVO}>+ Agregar planta nueva</option>
              </select>
            </div>
          )}
          {plNuevo && form.packing && (
            <div className="tarjeta" style={{ background: 'var(--paja-3)', padding: '.8rem' }}>
              <div className="campo"><label>Nombre de la planta *</label><input value={form.pl_nombre} onChange={(e) => setForm({ ...form, pl_nombre: e.target.value })} placeholder="Ej: Planta San Clemente" /></div>
              <div className="campo"><label>Dirección</label><input value={form.pl_direccion} onChange={(e) => setForm({ ...form, pl_direccion: e.target.value })} /></div>
              <div className="campo"><label>Comuna</label><input value={form.pl_comuna} onChange={(e) => setForm({ ...form, pl_comuna: e.target.value })} /></div>
              <p className="muted" style={{ margin: 0, fontSize: '.82rem' }}>Queda guardada para los próximos despachos.</p>
            </div>
          )}
          <div className="campo"><label>Chofer</label><input value={form.chofer} onChange={(e) => setForm({ ...form, chofer: e.target.value })} /></div>
          <button className="primario grande">Abrir despacho y cargar bins</button>
        </form>
        <Resultado msg={msg} />
        {recientes.length > 0 && (
          <>
            <h3>Despachos recientes</h3>
            {recientes.map((d) => (
              <div key={d.id} className="rank-item">
                <div className="fila-sup"><b className="mono">{d.patente}{d.carro ? ` + ${d.carro}` : ''}</b><span className="muted">{d.cerrado_en ? horaCorta(d.cerrado_en) : ''}</span></div>
                <div className="muted">{d.guia ? `Guía ${d.guia} · ` : <span style={{ color: 'var(--ambar)' }}>Sin guía · </span>}{d.destino}{d.sync ? '' : ' · por subir'}</div>
                {editGuia?.id === d.id ? guiaEditor : (
                  <button className="enlace" style={{ fontSize: '.85rem' }} onClick={() => setEditGuia({ id: d.id, valor: d.guia || '' })}>{d.guia ? 'Corregir guía' : 'Ingresar guía'}</button>
                )}
              </div>
            ))}
          </>
        )}
      </div>
    );
  }

  return (
    <div>
      <div className="bin-barra">
        <div><div className="muted">Camión</div><b className="mono">{actual.patente}</b>{actual.carro ? <div className="mono" style={{ fontSize: '.85rem' }}>+ carro {actual.carro}</div> : null}{actual.transportista ? <div className="muted" style={{ fontSize: '.8rem' }}>{actual.transportista}</div> : null}</div>
        <div className="bin-n"><b>{bins.length}</b> <span className="muted">bins</span></div>
        <button className="chico" onClick={cerrar}>Cerrar despacho</button>
      </div>
      {editGuia?.id === actual.id ? guiaEditor : (
        <p className="muted" style={{ marginTop: 0 }}>
          {actual.guia ? `Guía ${actual.guia}` : 'Sin guía'}{actual.destino ? ` · ${actual.destino}` : ''}{' · '}
          <button className="enlace" onClick={() => setEditGuia({ id: actual.id, valor: actual.guia || '' })}>{actual.guia ? 'Corregir guía' : 'Ingresar guía'}</button>
        </p>
      )}
      <CapturaQR etiqueta="Capturar bins que suben al camión" ayuda="Sigue capturando bins uno tras otro" onScan={leer} />
      <Resultado msg={msg} />
      {cargados.length > 0 && (
        <div className="tarjeta" style={{ marginTop: '.8rem' }}>
          {cargados.slice().reverse().map((e) => (
            <div key={e.id} className="fila-sup" style={{ alignItems: 'center', padding: '.3rem 0', borderBottom: '1px solid var(--borde)' }}>
              <span className="mono">{e.codigo} <span className="muted" style={{ fontSize: '.8rem' }}>{horaCorta(e.hecho_en)}</span></span>
              <button className="chico" onClick={() => quitar(e)}>✕ Quitar</button>
            </div>
          ))}
        </div>
      )}
      <button className="chico peligro" style={{ marginTop: '1rem' }} onClick={anular}>Anular este despacho</button>
    </div>
  );
}
