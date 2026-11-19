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
  const [buscar, setBuscar] = useState('');
  const [ahora, setAhora] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setAhora(Date.now()), 60000); return () => clearInterval(t); }, []);

  async function cargar() {
    const l = await db.entregas.where('fecha').equals(hoyISO()).toArray();
    l.sort((a, b) => b.leido_en.localeCompare(a.leido_en));
    setLista(l);
  }
  useEffect(() => { cargar(); }, [m]); // se recarga tras cada sincronización

  const porTrab = new Map<string, { id: string; nombre: string; envases: number; kilos: number; entregas: number; ultima: string }>();
  const validas = lista.filter(vigente);
  for (const e of validas) {
    const a = porTrab.get(e.trabajador_id) || { id: e.trabajador_id, nombre: e.trabajador_nombre || '', envases: 0, kilos: 0, entregas: 0, ultima: e.leido_en };
    a.envases += Number(e.cantidad); a.kilos += Number(e.kilos_estimados); a.entregas++;
    if (e.leido_en > a.ultima) a.ultima = e.leido_en;
    porTrab.set(e.trabajador_id, a);
  }
  const ranking = [...porTrab.values()].sort((a, b) => b.envases - a.envases);
  const total = validas.reduce((s, e) => s + Number(e.cantidad), 0);
  const kilos = validas.reduce((s, e) => s + Number(e.kilos_estimados), 0);
  const maxEnv = ranking[0]?.envases || 1;
  const envaseNombre = m.envases.find((x) => x.id === validas[0]?.envase_id)?.nombre?.toLowerCase() ?? 'envases';
  const visibles = buscar ? ranking.filter((r) => r.nombre.toLowerCase().includes(buscar.toLowerCase())) : ranking;
  const hace = (iso: string) => {
    const min = Math.max(0, Math.round((ahora - new Date(iso).getTime()) / 60000));
    if (min < 1) return 'recién';
    if (min < 60) return `hace ${min} min`;
    const h = Math.floor(min / 60), r = min % 60;
    return `hace ${h} h${r ? ` ${r} min` : ''}`;
  };
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
      <button className="btn-consultar" onClick={() => setConsultar(true)}>
        <span className="ico">🔍</span>
        <span><b>Consultar trabajador</b><br /><small>Ver su rendimiento de hoy y la semana</small></span>
        <span className="flecha">›</span>
      </button>

      <div className="resumen-dia">
        <div><b>{num(total, total % 1 ? 1 : 0)}</b><span>{envaseNombre}</span></div>
        <div><b>{num(kilos)}</b><span>kg est.</span></div>
        <div><b>{porTrab.size}</b><span>trabajadores</span></div>
      </div>

      <div className="tabs">
        <button className={ver === 'trab' ? 'activo' : ''} onClick={() => setVer('trab')}>Ranking</button>
        <button className={ver === 'ult' ? 'activo' : ''} onClick={() => setVer('ult')}>Últimas lecturas</button>
      </div>
      {!lista.length && <p className="muted" style={{ textAlign: 'center', marginTop: '2rem' }}>Sin entregas hoy en este teléfono.</p>}
      {ver === 'trab' ? (
        <>
          {ranking.length > 8 && (
            <input placeholder="Buscar trabajador…" value={buscar} onChange={(e) => setBuscar(e.target.value)} style={{ marginBottom: '.6rem' }} />
          )}
          <div className="ranking">
            {visibles.map((r) => {
              const pos = ranking.indexOf(r) + 1;
              return (
                <div key={r.id} className="rank-item">
                  <div className={`pos p${Math.min(pos, 4)}`}>{pos}</div>
                  <div className="info">
                    <div className="fila-sup">
                      <span className="nom">{r.nombre}</span>
                      <span className="cant">{num(r.envases, r.envases % 1 ? 1 : 0)}</span>
                    </div>
                    <div className="barra"><span style={{ width: `${Math.max(4, (r.envases / maxEnv) * 100)}%` }} /></div>
                    <div className="det">
                      <span>{r.entregas} entrega{r.entregas === 1 ? '' : 's'} · {num(r.kilos)} kg</span>
                      <span>última {horaCorta(r.ultima)} · {hace(r.ultima)}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </>
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
