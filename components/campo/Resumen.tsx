'use client';
import { useEffect, useState } from 'react';
import { db, EntregaLocal, vigente } from '@/lib/offline';
import { Maestros } from '@/lib/campo';
import Rendimiento from './Rendimiento';
import { horaCorta, hoyISO, num } from '@/lib/util';

export default function Resumen({ m, onCambio }: { m: Maestros; onCambio: () => void }) {
  const [lista, setLista] = useState<EntregaLocal[]>([]);
  const [ver, setVer] = useState<'trab' | 'ult'>('trab');
  const [consultar, setConsultar] = useState(false);

  async function cargar() {
    const l = await db.entregas.where('fecha').equals(hoyISO()).toArray();
    l.sort((a, b) => b.leido_en.localeCompare(a.leido_en));
    setLista(l);
  }
  useEffect(() => { cargar(); }, [m]); // se recarga tras cada sincronización

  const porTrab = new Map<string, { nombre: string; envases: number; entregas: number; ultima: string }>();
  const validas = lista.filter(vigente);
  for (const e of validas) {
    const a = porTrab.get(e.trabajador_id) || { nombre: e.trabajador_nombre || '', envases: 0, entregas: 0, ultima: e.leido_en };
    a.envases += Number(e.cantidad); a.entregas++;
    if (e.leido_en > a.ultima) a.ultima = e.leido_en;
    porTrab.set(e.trabajador_id, a);
  }
  const ranking = [...porTrab.values()].sort((a, b) => b.envases - a.envases);
  const total = validas.reduce((s, e) => s + Number(e.cantidad), 0);
  const kilos = validas.reduce((s, e) => s + Number(e.kilos_estimados), 0);
  const cuartel = (id: string) => m.cuarteles.find((c) => c.id === id)?.nombre ?? '';

  async function borrar(e: EntregaLocal) {
    if (e.sync) { alert('Ya se subió. Pide al administrador que la anule.'); return; }
    if (!confirm(`¿Borrar ${e.cantidad} de ${e.trabajador_nombre} (${horaCorta(e.leido_en)})?`)) return;
    await db.entregas.delete(e.id);
    cargar(); onCambio();
  }

  if (consultar) return <Rendimiento m={m} onCerrar={() => setConsultar(false)} />;

  return (
    <div>
      <button className="primario grande" style={{ marginBottom: '.8rem' }} onClick={() => setConsultar(true)}>🔍 Consultar rendimiento de un trabajador</button>
      <div className="kpis" style={{ gridTemplateColumns: 'repeat(3,1fr)' }}>
        <div className="kpi"><div className="v">{num(total)}</div><div className="l">Envases</div></div>
        <div className="kpi"><div className="v">{num(kilos)}</div><div className="l">Kg est.</div></div>
        <div className="kpi"><div className="v">{porTrab.size}</div><div className="l">Trabajadores</div></div>
      </div>
      <div className="tabs">
        <button className={ver === 'trab' ? 'activo' : ''} onClick={() => setVer('trab')}>Por trabajador</button>
        <button className={ver === 'ult' ? 'activo' : ''} onClick={() => setVer('ult')}>Últimas lecturas</button>
      </div>
      {!lista.length && <p className="muted">Sin entregas hoy en este teléfono.</p>}
      {ver === 'trab' ? (
        <ul className="lista-entregas">
          {ranking.map((r, i) => (
            <li key={i}>
              <span><span className="muted">{i + 1}.</span> {r.nombre}<br /><span className="muted">{r.entregas} entregas · última {horaCorta(r.ultima)}</span></span>
              <b style={{ fontSize: '1.2rem' }}>{num(r.envases)}</b>
            </li>
          ))}
        </ul>
      ) : (
        <ul className="lista-entregas">
          {lista.slice(0, 100).map((e) => (
            <li key={e.id}>
              <span>
                <span style={e.estado === 'X' ? { textDecoration: 'line-through', opacity: .6 } : undefined}>{horaCorta(e.leido_en)} · {e.trabajador_nombre}</span>
                {e.estado === 'X' && <> <span className="badge err">Anulada</span></>}
                {e.estado === 'D' && <> <span className="badge av">Duplicada</span></>}
                {e.editada && e.estado !== 'X' && <> <span className="badge">Corregida</span></>}<br />
                <span className="muted">{cuartel(e.cuartel_id)}{e.codigo_caja ? ` · ${e.codigo_caja}` : ''}</span>
              </span>
              <span className="acciones">
                <b>{num(e.cantidad)}</b>
                {e.sync ? <span className="badge ok">☁</span> : <button className="chico peligro" onClick={() => borrar(e)}>✕</button>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
