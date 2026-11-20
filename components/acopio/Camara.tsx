'use client';
import { useEffect, useState } from 'react';
import CapturaQR from '@/components/CapturaQR';
import { ESTADOS_BIN, estadoBin, registrarEvento } from '@/lib/bins';
import { db } from '@/lib/offline';
import { Maestros } from '@/lib/campo';
import { beep, horaCorta, normalizarCodigo, tipoCodigo, vibrar } from '@/lib/util';
import { Msg, Resultado } from './Comunes';

type EnCamara = { codigo: string; camara_id: string; inicio: string };

/** Bins que están hoy en cámara: lo que bajó del servidor más los movimientos locales */
async function binsEnCamara(m: Maestros): Promise<EnCamara[]> {
  const codigos = new Set<string>([
    ...m.bins_activos.filter((b) => b.estado === 'en_camara').map((b) => b.codigo),
    ...(await db.eventos.where('tipo').anyOf('camara_entrada', 'camara_salida', 'despachar').toArray()).map((e) => e.codigo),
  ]);
  const out: EnCamara[] = [];
  for (const c of codigos) {
    const b = await estadoBin(c);
    if (b.estado === 'en_camara' && b.camara_id && b.camara_inicio) out.push({ codigo: c, camara_id: b.camara_id, inicio: b.camara_inicio });
  }
  return out.sort((a, b) => a.inicio.localeCompare(b.inicio));
}

export default function Camara({ m, onCambio }: { m: Maestros; onCambio: () => void }) {
  const camaras = m.camaras.filter((c) => c.activo !== false);
  const [camara, setCamara] = useState(camaras[0]?.id ?? '');
  const [modo, setModo] = useState<'entrada' | 'salida'>('entrada');
  const [msg, setMsg] = useState<Msg>(null);
  const [lista, setLista] = useState<EnCamara[]>([]);
  const [ahora, setAhora] = useState(Date.now());

  async function refrescar() { setLista(await binsEnCamara(m)); }
  useEffect(() => { refrescar(); }, [m]); // eslint-disable-line
  useEffect(() => { const t = setInterval(() => setAhora(Date.now()), 30000); return () => clearInterval(t); }, []);

  function error(titulo: string, detalle?: string) { setMsg({ t: 'err', titulo, detalle }); beep(false); vibrar([200, 100, 200]); }

  async function leer(texto: string): Promise<boolean | void> {
    const codigo = normalizarCodigo(texto);
    if (tipoCodigo(codigo) !== 'L') { error('No es una etiqueta de bin', codigo.slice(0, 40)); return false; }
    const b = await estadoBin(codigo);
    if (modo === 'entrada') {
      if (!camara) return error('Elige la cámara');
      if (!b.estado || b.estado === 'abierto' || b.estado === 'cerrado') { error('Primero recibe el bin', `${codigo} · ${b.estado ? ESTADOS_BIN[b.estado] : 'sin registro'}`); return false; }
      if (b.estado === 'en_camara') { error('Ya está en cámara', codigo); return false; }
      await registrarEvento('camara_entrada', codigo, { camara_id: camara }, b.id);
    } else {
      if (b.estado !== 'en_camara') { error('No está en cámara', `${codigo} · ${b.estado ? ESTADOS_BIN[b.estado] : 'sin registro'}`); return false; }
      await registrarEvento('camara_salida', codigo, {}, b.id);
    }
    beep(true); vibrar(60);
    setMsg({ t: 'ok', titulo: modo === 'entrada' ? '✔ Entró a cámara' : '✔ Salió de cámara', detalle: codigo });
    await refrescar();
    onCambio();
    return false; // la cámara sigue encendida para el siguiente bin
  }

  if (!camaras.length) return <div className="alerta aviso">No hay cámaras de frío configuradas. El administrador las crea en Acopio y bins.</div>;

  const minutos = (iso: string) => Math.round((ahora - new Date(iso).getTime()) / 60000);

  return (
    <div>
      <div className="segmentado" style={{ marginBottom: '.7rem' }}>
        <button className={modo === 'entrada' ? 'activo' : ''} onClick={() => setModo('entrada')}>Entrada</button>
        <button className={modo === 'salida' ? 'activo' : ''} onClick={() => setModo('salida')}>Salida</button>
      </div>
      {modo === 'entrada' && (
        <div className="campo">
          <label>Cámara</label>
          <select value={camara} onChange={(e) => setCamara(e.target.value)}>
            {camaras.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
          </select>
        </div>
      )}
      <CapturaQR etiqueta={modo === 'entrada' ? 'Capturar bins que entran' : 'Capturar bins que salen'} ayuda="Sigue capturando bins uno tras otro" onScan={leer} />
      <Resultado msg={msg} />

      <h3>En cámara ({lista.length})</h3>
      {!lista.length && <p className="muted">No hay bins en cámara.</p>}
      {lista.map((b) => {
        const c = m.camaras.find((x) => x.id === b.camara_id);
        const min = minutos(b.inicio);
        const alerta = c?.minutos_alerta > 0 && min >= c.minutos_alerta;
        const listo = c?.minutos_objetivo > 0 && min >= c.minutos_objetivo;
        return (
          <div key={b.codigo} className={`rank-item ${alerta ? 'alerta-fila' : ''}`}>
            <div className="fila-sup">
              <b className="mono">{b.codigo.slice(-6)}</b>
              <span>{alerta ? '⚠ ' : listo ? '✔ ' : ''}{min} min</span>
            </div>
            <div className="muted">{c?.nombre} · desde {horaCorta(b.inicio)}{c?.minutos_objetivo ? ` · objetivo ${c.minutos_objetivo} min` : ''}</div>
          </div>
        );
      })}
    </div>
  );
}
