'use client';
import { useState } from 'react';
import CapturaQR from '@/components/CapturaQR';
import { BinActual, ESTADOS_BIN, estadoBin, registrarEvento } from '@/lib/bins';
import { configDe, Maestros } from '@/lib/campo';
import { beep, hablar, normalizarCodigo, tipoCodigo, uuid, vibrar } from '@/lib/util';
import type { Perfil } from '@/lib/auth';
import { FichaBin, FormCalidad, FotoLocal, Fotos, Msg, Resultado, validarCalidad, ValoresCalidad } from './Comunes';

export default function Recibir({ m, perfil, onCambio }: { m: Maestros; perfil: Perfil; onCambio: () => void }) {
  const [bin, setBin] = useState<BinActual | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  const [valores, setValores] = useState<ValoresCalidad>({});
  const [obs, setObs] = useState('');
  const [fotos, setFotos] = useState<FotoLocal[]>([]);
  const [verCalidad, setVerCalidad] = useState(false);
  const [manual, setManual] = useState('');

  const cfg = configDe(m, bin?.servidor?.huerto_id ?? undefined);
  const exige = !!cfg.exige_calidad_recepcion;
  const params = m.parametros_calidad.filter((p) => p.activo !== false).sort((a, b) => a.orden - b.orden);

  function error(titulo: string, detalle?: string) { setMsg({ t: 'err', titulo, detalle }); beep(false); vibrar([200, 100, 200]); }

  async function leer(texto: string): Promise<boolean | void> {
    const codigo = normalizarCodigo(texto);
    if (tipoCodigo(codigo) !== 'L') { error('No es una etiqueta de bin', codigo.slice(0, 40)); return false; }
    const b = await estadoBin(codigo);
    if (b.estado && !['abierto', 'cerrado'].includes(b.estado)) {
      error('Bin ya recibido', `${codigo} · ${ESTADOS_BIN[b.estado]}`);
      return;
    }
    beep(true); vibrar(60);
    setBin(b); setValores({}); setObs(''); setFotos([]);
    setVerCalidad(exige);
    setMsg(b.estado ? null : { t: 'av', titulo: 'Sin registro de campo', detalle: 'Puede que el jefe aún no sincronice. Se recibe igual y se une cuando llegue.' });
  }

  async function recibir() {
    if (!bin) return;
    const v = validarCalidad(params, valores, exige);
    if (!v.ok) return error('Revisa la calidad', v.error);
    await registrarEvento('recibir', bin.codigo, {
      calidad: v.datos, observacion: obs.trim() || null, fotos: fotos.map((f) => f.nombre),
    }, bin.id ?? uuid(), fotos.map(({ nombre, blob }) => ({ nombre, blob })));
    beep(true); vibrar(80); hablar('Recibido');
    setMsg({ t: 'ok', titulo: '✔ Bin recibido', detalle: bin.codigo });
    setBin(null);
    onCambio();
  }

  if (bin) {
    return (
      <div>
        <FichaBin b={bin} />
        {bin.estado === 'abierto' && <div className="alerta aviso">El bin sigue abierto en campo: al recibirlo queda cerrado.</div>}
        <Resultado msg={msg} />

        {params.length > 0 && (
          <div className="tarjeta">
            <button type="button" className="enlace" onClick={() => setVerCalidad(!verCalidad)}>
              {verCalidad ? '▾' : '▸'} Calidad {exige ? '(obligatoria)' : '(opcional)'}
            </button>
            {verCalidad && <FormCalidad params={params} valores={valores} setValores={setValores} />}
          </div>
        )}
        <div className="campo">
          <label>Observación</label>
          <input value={obs} onChange={(e) => setObs(e.target.value)} placeholder="Opcional" />
        </div>
        <Fotos empresaId={perfil.empresa_id} fotos={fotos} setFotos={setFotos} />
        <button className="primario grande" style={{ marginTop: '.8rem' }} onClick={recibir}>Registrar recepción</button>
        <button className="grande" style={{ marginTop: '.5rem' }} onClick={() => { setBin(null); setMsg(null); }}>Cancelar</button>
      </div>
    );
  }

  return (
    <div>
      <CapturaQR etiqueta="Capturar bin que llega" onScan={leer} />
      <Resultado msg={msg} />
      <details style={{ marginTop: '1rem' }}>
        <summary className="muted">Escribir código</summary>
        <div className="fila" style={{ marginTop: '.6rem' }}>
          <input className="mono" placeholder="BC-L-…" value={manual} onChange={(e) => setManual(e.target.value)} />
          <button style={{ flex: '0 0 auto' }} onClick={() => { leer(manual); setManual(''); }}>OK</button>
        </div>
      </details>
    </div>
  );
}
