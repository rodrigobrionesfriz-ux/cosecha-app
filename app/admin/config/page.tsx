'use client';
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { useTabla, errorAmigable } from '@/lib/datos';
import Crud from '@/components/Crud';

const DEF = {
  modo_captura: 'credencial_cantidad',
  horas_bloqueo_caja: 12,
  segundos_entre_lecturas: 10,
  max_cajas_por_lectura: 10,
  exige_calidad: true,
  exige_turno: false,
  exige_contratista: false,
  con_gps: false,
  permite_rut_extranjero: true,
};

export default function Config() {
  const { perfil } = useAuth();
  const huertos = useTabla<any>('huertos', 'id,nombre', 'orden');
  const envases = useTabla<any>('envases', 'id,nombre', 'nombre');
  const calidades = useTabla<any>('calidades', 'id,nombre', 'orden');
  const especies = useTabla<any>('especies', 'id,nombre', 'nombre');
  const [huerto, setHuerto] = useState('');
  const [cfg, setCfg] = useState<any>(null);
  const [msg, setMsg] = useState<{ t: string; m: string } | null>(null);

  useEffect(() => { if (!huerto && huertos.filas[0]) setHuerto(huertos.filas[0].id); }, [huertos.filas, huerto]);
  useEffect(() => {
    if (!huerto) return;
    supabase.from('config_huerto').select('*').eq('huerto_id', huerto).maybeSingle().then(({ data }) => {
      setCfg(data || { ...DEF, huerto_id: huerto });
      setMsg(null);
    });
  }, [huerto]);

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    const { updated_at, ...d } = cfg;
    const { error } = await supabase.from('config_huerto').upsert({ ...d, huerto_id: huerto, empresa_id: perfil!.empresa_id });
    setMsg(error ? { t: 'error', m: errorAmigable(error.message) } : { t: 'ok', m: 'Reglas guardadas. Los teléfonos las toman en la próxima sincronización.' });
  }

  const set = (k: string, v: any) => setCfg({ ...cfg, [k]: v });
  const op = (l: any[]) => l.map((x) => ({ v: x.id, t: x.nombre }));

  return (
    <div>
      <h1>Reglas y tarifas</h1>

      <h2>Reglas de captura por huerto</h2>
      {!huertos.filas.length && <div className="alerta aviso">Primero crea un huerto en <a href="/admin/maestros/">Huertos y maestros</a>.</div>}
      {huertos.filas.length > 0 && (
        <div className="campo" style={{ maxWidth: 320 }}>
          <label>Huerto</label>
          <select value={huerto} onChange={(e) => setHuerto(e.target.value)}>
            {huertos.filas.map((h) => <option key={h.id} value={h.id}>{h.nombre}</option>)}
          </select>
        </div>
      )}
      {cfg && (
        <form className="tarjeta" onSubmit={guardar}>
          <div className="fila">
            <div className="campo">
              <label>Modo de registro</label>
              <select value={cfg.modo_captura} onChange={(e) => set('modo_captura', e.target.value)}>
                <option value="credencial_cantidad">Credencial + cantidad (sin etiqueta de caja)</option>
                <option value="credencial_caja">Credencial + QR de cada caja</option>
              </select>
            </div>
            <div className="campo">
              <label>Máximo de envases por lectura</label>
              <input type="number" min={1} max={50} value={cfg.max_cajas_por_lectura} onChange={(e) => set('max_cajas_por_lectura', +e.target.value)} />
            </div>
            <div className="campo">
              <label>Segundos mínimos entre lecturas del mismo trabajador</label>
              <input type="number" min={0} value={cfg.segundos_entre_lecturas} onChange={(e) => set('segundos_entre_lecturas', +e.target.value)} />
            </div>
            <div className="campo">
              <label>Horas de bloqueo de una etiqueta de caja</label>
              <input type="number" min={0} value={cfg.horas_bloqueo_caja} onChange={(e) => set('horas_bloqueo_caja', +e.target.value)} disabled={cfg.modo_captura !== 'credencial_caja'} />
            </div>
          </div>
          <div className="fila" style={{ gap: '1.2rem' }}>
            {[
              ['exige_calidad', 'Exigir calidad'],
              ['exige_turno', 'Exigir turno'],
              ['exige_contratista', 'Exigir contratista'],
              ['con_gps', 'Guardar ubicación GPS'],
              ['permite_rut_extranjero', 'Permitir trabajadores extranjeros (sin RUT)'],
            ].map(([k, t]) => (
              <label key={k} className="check" style={{ flex: '0 1 auto' }}>
                <input type="checkbox" checked={!!cfg[k]} onChange={(e) => set(k, e.target.checked)} /> {t}
              </label>
            ))}
          </div>
          {msg && <div className={`alerta ${msg.t}`}>{msg.m}</div>}
          <div style={{ marginTop: '1rem' }}><button className="primario">Guardar reglas</button></div>
        </form>
      )}

      <Crud tabla="tarifas" titulo="Tarifas de pago por envase" orden="vigente_desde"
        ayuda="Valor en $ por envase. Si una tarifa no tiene calidad, aplica a todas. Se usa la tarifa vigente más reciente a la fecha de la entrega."
        campos={[
          { k: 'envase_id', t: 'Envase', tipo: 'select', opciones: op(envases.filas), req: true },
          { k: 'calidad_id', t: 'Calidad', tipo: 'select', opciones: op(calidades.filas) },
          { k: 'especie_id', t: 'Especie', tipo: 'select', opciones: op(especies.filas) },
          { k: 'valor', t: 'Valor $', tipo: 'number', req: true, ancho: 130 },
          { k: 'vigente_desde', t: 'Vigente desde (AAAA-MM-DD)', req: true, ancho: 200, def: new Date().toISOString().slice(0, 10) },
        ]} />
    </div>
  );
}
