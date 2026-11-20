'use client';
import { useEffect, useState } from 'react';
import CapturaQR from '@/components/CapturaQR';
import { ESTADOS_BIN, estadoBin, registrarEvento } from '@/lib/bins';
import { db, DespachoLocal, usuarioActual } from '@/lib/offline';
import { Maestros } from '@/lib/campo';
import { beep, hablar, horaCorta, normalizarCodigo, tipoCodigo, uuid, vibrar } from '@/lib/util';
import type { Perfil } from '@/lib/auth';
import { Msg, Resultado } from './Comunes';

export default function Despacho({ m, perfil, onCambio }: { m: Maestros; perfil: Perfil; onCambio: () => void }) {
  const [actual, setActual] = useState<DespachoLocal | null>(null);
  const [bins, setBins] = useState<string[]>([]);
  const [form, setForm] = useState({ patente: '', guia: '', destino: '', chofer: '' });
  const [msg, setMsg] = useState<Msg>(null);
  const [recientes, setRecientes] = useState<DespachoLocal[]>([]);

  async function cargar() {
    const uid = usuarioActual();
    const todos = (await db.despachos.toArray()).filter((d) => d.usuario === uid).sort((a, b) => b.abierto_en.localeCompare(a.abierto_en));
    const ab = todos.find((d) => d.estado === 'abierto') || null;
    setActual(ab);
    setRecientes(todos.filter((d) => d.estado === 'cerrado').slice(0, 5));
    if (ab) {
      const ev = await db.eventos.where('tipo').equals('despachar').toArray();
      setBins(ev.filter((e) => e.datos?.despacho_id === ab.id && (!e.resultado || e.resultado === 'OK')).map((e) => e.codigo));
    } else setBins([]);
  }
  useEffect(() => { cargar(); }, [m]); // eslint-disable-line

  function error(titulo: string, detalle?: string) { setMsg({ t: 'err', titulo, detalle }); beep(false); vibrar([200, 100, 200]); }

  async function abrir(e: React.FormEvent) {
    e.preventDefault();
    if (!form.patente.trim()) return error('Falta la patente');
    const d: DespachoLocal = {
      id: uuid(), empresa_id: perfil.empresa_id, patente: form.patente.trim().toUpperCase(), guia: form.guia.trim(),
      destino: form.destino.trim(), chofer: form.chofer.trim(), estado: 'abierto', abierto_en: new Date().toISOString(),
      cerrado_en: null, usuario: usuarioActual(), sync: 0,
    };
    await db.despachos.add(d);
    setForm({ patente: '', guia: '', destino: '', chofer: '' });
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
    setBins([...bins, codigo]);
    onCambio();
    return false; // seguir cargando
  }

  async function cerrar() {
    if (!actual) return;
    if (!bins.length && !confirm('El camión no tiene bins. ¿Cerrarlo igual?')) return;
    if (bins.length && !confirm(`¿Cerrar el despacho ${actual.patente} con ${bins.length} bins?`)) return;
    await db.despachos.update(actual.id, { estado: 'cerrado', cerrado_en: new Date().toISOString(), sync: 0 });
    hablar('Despacho cerrado');
    setMsg({ t: 'ok', titulo: 'Despacho cerrado', detalle: `${actual.patente} · ${bins.length} bins` });
    await cargar(); onCambio();
  }

  if (!actual) {
    return (
      <div>
        <form className="tarjeta" onSubmit={abrir}>
          <h3 style={{ marginTop: 0 }}>Nuevo despacho</h3>
          <div className="campo"><label>Patente *</label><input value={form.patente} onChange={(e) => setForm({ ...form, patente: e.target.value })} className="mono" /></div>
          <div className="campo"><label>N° guía de despacho</label><input inputMode="numeric" value={form.guia} onChange={(e) => setForm({ ...form, guia: e.target.value })} /></div>
          <div className="campo"><label>Destino</label><input value={form.destino} onChange={(e) => setForm({ ...form, destino: e.target.value })} placeholder="Planta, packing…" /></div>
          <div className="campo"><label>Chofer</label><input value={form.chofer} onChange={(e) => setForm({ ...form, chofer: e.target.value })} /></div>
          <button className="primario grande">Abrir despacho y cargar bins</button>
        </form>
        <Resultado msg={msg} />
        {recientes.length > 0 && (
          <>
            <h3>Despachos recientes</h3>
            {recientes.map((d) => (
              <div key={d.id} className="rank-item">
                <div className="fila-sup"><b>{d.patente}</b><span className="muted">{d.cerrado_en ? horaCorta(d.cerrado_en) : ''}</span></div>
                <div className="muted">{d.guia ? `Guía ${d.guia} · ` : ''}{d.destino}{d.sync ? '' : ' · por subir'}</div>
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
        <div><div className="muted">Camión</div><b className="mono">{actual.patente}</b></div>
        <div className="bin-n"><b>{bins.length}</b> <span className="muted">bins</span></div>
        <button className="chico" onClick={cerrar}>Cerrar despacho</button>
      </div>
      {actual.guia && <p className="muted" style={{ marginTop: 0 }}>Guía {actual.guia}{actual.destino ? ` · ${actual.destino}` : ''}</p>}
      <CapturaQR etiqueta="Capturar bins que suben al camión" ayuda="Sigue capturando bins uno tras otro" onScan={leer} />
      <Resultado msg={msg} />
      {bins.length > 0 && (
        <div className="tarjeta" style={{ marginTop: '.8rem' }}>
          {bins.slice().reverse().map((c) => <div key={c} className="mono">{c}</div>)}
        </div>
      )}
    </div>
  );
}
