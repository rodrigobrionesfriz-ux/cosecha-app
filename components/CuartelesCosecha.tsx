'use client';
import { useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { useTabla } from '@/lib/datos';

/** Habilita o deshabilita cuarteles para cosecha. Solo los habilitados aparecen en la app de terreno. */
export default function CuartelesCosecha({ onCambio }: { onCambio?: () => void }) {
  const { perfil } = useAuth();
  const esAdmin = perfil?.rol === 'admin';
  const huertos = useTabla<any>('huertos', 'id,nombre,activo', 'orden');
  const cuarteles = useTabla<any>('cuarteles', 'id,nombre,huerto_id,variedad_id,en_cosecha,activo', 'nombre');
  const variedades = useTabla<any>('variedades', 'id,nombre', 'nombre');
  const [guardando, setGuardando] = useState<string | null>(null);
  const [abiertos, setAbiertos] = useState<Set<string>>(new Set());

  async function cambiar(ids: string[], valor: boolean, clave: string) {
    if (!ids.length) return;
    setGuardando(clave);
    const { error } = await supabase.from('cuarteles').update({ en_cosecha: valor }).in('id', ids);
    setGuardando(null);
    if (error) { alert(error.message); return; }
    cuarteles.setFilas(cuarteles.filas.map((c) => (ids.includes(c.id) ? { ...c, en_cosecha: valor } : c)));
    onCambio?.();
  }

  const variedad = (id: string) => variedades.filas.find((v) => v.id === id)?.nombre;
  const toggleAbierto = (id: string) => { const s = new Set(abiertos); s.has(id) ? s.delete(id) : s.add(id); setAbiertos(s); };
  const totalHab = cuarteles.filas.filter((c) => c.en_cosecha && c.activo).length;

  if (huertos.cargando || cuarteles.cargando) return <p className="muted">Cargando…</p>;

  return (
    <div className="tarjeta">
      <div className="encabezado" style={{ marginBottom: '.4rem' }}>
        <h2 style={{ margin: 0 }}>Habilitados para cosecha</h2>
        <span className={`badge ${totalHab ? 'ok' : 'av'}`}>{totalHab} cuartel{totalHab === 1 ? '' : 'es'} habilitado{totalHab === 1 ? '' : 's'}</span>
      </div>
      <p className="muted" style={{ marginTop: 0 }}>
        Los jefes de cuadrilla solo ven y pueden registrar en los cuarteles habilitados. Los teléfonos toman el cambio en la próxima sincronización (máximo 3 minutos con señal).
      </p>

      {!huertos.filas.length && <div className="alerta aviso">Primero crea un huerto.</div>}

      {huertos.filas.map((h) => {
        const lista = cuarteles.filas.filter((c) => c.huerto_id === h.id && c.activo);
        const hab = lista.filter((c) => c.en_cosecha).length;
        const abierto = abiertos.has(h.id) || lista.length <= 6;
        const estado = !lista.length ? '' : hab === lista.length ? 'ok' : hab === 0 ? '' : 'av';
        return (
          <div key={h.id} className="grupo-huerto">
            <div className="grupo-cab">
              <button type="button" className="grupo-titulo" onClick={() => toggleAbierto(h.id)}>
                <span>{abierto ? '▾' : '▸'}</span>
                <b>{h.nombre}</b>
                <span className={`badge ${estado}`}>{hab} de {lista.length}</span>
              </button>
              {esAdmin && lista.length > 0 && (
                <div className="acciones">
                  <button className="chico primario" disabled={guardando === h.id || hab === lista.length}
                    onClick={() => cambiar(lista.map((c) => c.id), true, h.id)}>Habilitar todos</button>
                  <button className="chico" disabled={guardando === h.id || hab === 0}
                    onClick={() => cambiar(lista.map((c) => c.id), false, h.id)}>Deshabilitar todos</button>
                </div>
              )}
            </div>
            {abierto && (
              <div className="grupo-lista">
                {!lista.length && <div className="muted" style={{ padding: '.4rem .2rem' }}>Sin cuarteles.</div>}
                {lista.map((c) => (
                  <label key={c.id} className={`interruptor ${c.en_cosecha ? 'on' : ''}`}>
                    <input type="checkbox" checked={!!c.en_cosecha} disabled={!esAdmin || guardando === c.id}
                      onChange={(e) => cambiar([c.id], e.target.checked, c.id)} />
                    <span className="pista" aria-hidden />
                    <span className="txt">
                      {c.nombre}
                      {c.variedad_id && <span className="muted"> · {variedad(c.variedad_id)}</span>}
                    </span>
                  </label>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
