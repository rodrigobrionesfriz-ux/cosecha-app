'use client';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { cargarTabla } from '@/lib/datos';
import { Ficha } from '@/lib/ingresos';
import { HojasIRL, CSS, Tipo } from '@/components/HojasIRL';
import { useAuth } from '@/lib/auth';


export default function ImprimirIRL() {
  const { perfil } = useAuth();
  const [f, setF] = useState<Ficha | null>(null);
  const [error, setError] = useState('');
  const [tipo, setTipo] = useState<Tipo>('nuevo');
  const [cargo, setCargo] = useState('Trabajador agrícola – Cosecha');
  const [llenarRiohs, setLlenarRiohs] = useState(true);
  const [escala, setEscala] = useState(1);
  const caja = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const id = new URLSearchParams(location.search).get('id');
    if (!id) { setError('Falta el trabajador.'); return; }
    cargarTabla<Ficha>('v_fichas_ingreso', '*', (q) => q.eq('trabajador_id', id))
      .then(([fi]) => (fi ? setF(fi) : setError('Este trabajador no tiene ficha de ingreso.')))
      .catch((e) => setError(e.message));
  }, []);

  // En pantalla la hoja se achica para caber en el teléfono; al imprimir va a tamaño real
  useLayoutEffect(() => {
    const ajustar = () => { const w = caja.current?.clientWidth ?? 0; setEscala(w ? Math.min(1, w / 816) : 1); };
    ajustar(); window.addEventListener('resize', ajustar);
    return () => window.removeEventListener('resize', ajustar);
  }, [f]);

  if (error) return <div className="alerta error">{error}</div>;
  if (!f) return <p className="muted">Cargando…</p>;

  return (
    <div className="irl-wrap">
      <style>{CSS}</style>
      <div className="no-print irl-controles tarjeta">
        <div className="fila">
          <div className="campo">
            <label>Situación del trabajador</label>
            <select value={tipo} onChange={(e) => setTipo(e.target.value as Tipo)}>
              <option value="nuevo">Trabajador nuevo</option>
              <option value="transferido">Trabajador transferido</option>
              <option value="ausencia">Ausencia prolongada</option>
            </select>
          </div>
          <div className="campo"><label>Cargo</label><input value={cargo} onChange={(e) => setCargo(e.target.value)} /></div>
        </div>
        <label className="check"><input type="checkbox" checked={llenarRiohs} onChange={(e) => setLlenarRiohs(e.target.checked)} /> Completar nombre, RUT y fecha en el acuse del Reglamento (si no, el trabajador los escribe a mano)</label>
        <div className="acciones" style={{ marginTop: '.6rem' }}>
          <button className="primario" onClick={() => window.print()}>🖨️ Imprimir IRL y Reglamento</button>
          <button onClick={() => window.close()}>Cerrar</button>
        </div>
        <p className="muted" style={{ margin: '.5rem 0 0', fontSize: '.85rem' }}>Se imprimen 2 hojas tamaño carta. En la ventana de impresión deja los márgenes en &quot;Predeterminados&quot; o &quot;Ninguno&quot; y desactiva encabezados y pies de página del navegador.</p>
      </div>

      <div className="irl-hojas" ref={caja}>
        <div style={{ zoom: escala } as any}>
          <HojasIRL f={f} tipo={tipo} cargo={cargo} llenarRiohs={llenarRiohs} empresa={perfil?.empresa} />
        </div>
      </div>
    </div>
  );
}

