'use client';
import { useState } from 'react';
import { useAuth } from '@/lib/auth';
import { cargarTabla } from '@/lib/datos';
import type { Respaldo } from '@/lib/proteccion';
import { supabase } from '@/lib/supabase';
import { fechaCL, horaCorta } from '@/lib/util';

/** Carga un respaldo de emergencia sacado desde un teléfono que no pudo sincronizar */
export default function ImportarRespaldo() {
  const { perfil } = useAuth();
  const [r, setR] = useState<Respaldo | null>(null);
  const [archivo, setArchivo] = useState('');
  const [autor, setAutor] = useState('');
  const [trabajando, setTrabajando] = useState(false);
  const [paso, setPaso] = useState('');
  const [resultado, setResultado] = useState<{ ok: boolean; lineas: string[] } | null>(null);

  async function leer(f: File) {
    setResultado(null); setR(null); setArchivo(f.name);
    try {
      const d = JSON.parse(await f.text());
      if (d?.tipo !== 'qsecha-respaldo') throw new Error('El archivo no es un respaldo de QSecha.');
      if (d.empresa_id !== perfil?.empresa_id) throw new Error('El respaldo es de otra empresa.');
      setR(d);
      const [p] = await cargarTabla<any>('perfiles', 'nombre', (q) => q.eq('user_id', d.usuario));
      setAutor(p?.nombre || 'usuario desconocido');
    } catch (e: any) { setResultado({ ok: false, lineas: [e.message || 'No se pudo leer el archivo'] }); }
  }

  async function importar() {
    if (!r || !confirm('¿Cargar este respaldo en la nube? Lo que ya estaba subido se omite.')) return;
    setTrabajando(true); setResultado(null);
    const lineas: string[] = [];
    try {
      // 1) credenciales asignadas sin señal (crean trabajadores nuevos)
      let nAsig = 0;
      for (const [i, a] of r.asignaciones.entries()) {
        setPaso(`Credenciales ${i + 1} de ${r.asignaciones.length}…`);
        const { data, error } = await supabase.rpc('asignar_credencial', {
          p_id: a.id, p_codigo: a.codigo, p_rut: a.rut, p_nombres: a.nombres || null,
          p_apellido_paterno: a.apellido_paterno || null, p_apellido_materno: a.apellido_materno || null,
          p_contratista_id: a.contratista_id || null, p_extranjero: !!a.extranjero, p_forzar: !!a.forzar,
          ...(a.actualiza_contratista ? { p_actualiza_contratista: true } : {}),
        });
        if (error) lineas.push(`Credencial ${a.codigo}: ${error.message}`);
        else { nAsig++; if ((data as any)?.resultado && (data as any).resultado !== 'CR') lineas.push(`Credencial ${a.codigo}: ${(data as any).resultado}`); }
      }
      // 2) entregas de trabajadores creados sin señal: se resuelven por su credencial
      setPaso('Resolviendo trabajadores nuevos…');
      const cred = await cargarTabla<any>('tarjetas', 'codigo,trabajador_id', (q) => q.eq('tipo', 'W').eq('estado', 'asignada'));
      const porCodigo = new Map(cred.map((c) => [c.codigo, c.trabajador_id]));
      let sinResolver = 0;
      const entregas = r.entregas.map((e) => {
        if (!String(e.trabajador_id).startsWith('local:')) return e;
        const t = porCodigo.get(e.codigo_credencial);
        if (!t) { sinResolver++; return e; }
        return { ...e, trabajador_id: t };
      });
      // 3) fotos de recepción
      let nFotos = 0;
      for (const ev of r.eventos) {
        for (const f of ev.fotos || []) {
          setPaso(`Subiendo fotos (${nFotos + 1})…`);
          const bin = Uint8Array.from(atob(f.base64), (c) => c.charCodeAt(0));
          const { error } = await supabase.storage.from('acopio-fotos').upload(f.nombre, new Blob([bin], { type: 'image/jpeg' }), { upsert: true, contentType: 'image/jpeg' });
          if (error && !/exists/i.test(error.message)) lineas.push(`Foto ${f.nombre}: ${error.message}`); else nFotos++;
        }
      }
      // 4) despachos, movimientos de bins, entregas y destinos
      setPaso('Cargando registros…');
      const { data, error } = await supabase.rpc('importar_respaldo', {
        p: { ...r, entregas, eventos: r.eventos.map(({ fotos, ...e }: any) => e) },
      });
      if (error) throw new Error(error.message);
      const d = data as any;
      lineas.unshift(
        `Entregas nuevas: ${d.entregas} de ${r.entregas.length} (las demás ya estaban en la nube).`,
        `Movimientos de bins nuevos: ${d.eventos} de ${r.eventos.length}. Despachos: ${d.despachos}. Credenciales: ${nAsig}. Fotos: ${nFotos}.`,
        ...(d.packings || d.plantas ? [`Destinos nuevos: ${d.packings} packing(s), ${d.plantas} planta(s).`] : []),
        ...(sinResolver ? [`${sinResolver} entrega(s) quedaron sin cargar porque su credencial no se pudo asignar. Revisa las credenciales y vuelve a cargar el mismo archivo.`] : []),
      );
      setResultado({ ok: !sinResolver, lineas });
    } catch (e: any) {
      setResultado({ ok: false, lineas: [e.message || 'Error al importar', ...lineas] });
    }
    setPaso(''); setTrabajando(false);
  }

  if (perfil?.rol !== 'admin') return <div><h1>Importar respaldo</h1><div className="alerta aviso">Solo administradores.</div></div>;

  return (
    <div>
      <h1>Importar respaldo de teléfono</h1>
      <p className="muted" style={{ marginTop: 0 }}>
        Cuando un teléfono no puede sincronizar (sin señal, va a reparación o se cambia), el jefe u operador saca un <b>Respaldo de emergencia</b> en la pestaña Sincronizar y te envía el archivo. Cárgalo aquí. Se puede cargar más de una vez sin duplicar nada.
      </p>
      <section className="tarjeta">
        <label className="boton-archivo">
          📂 Elegir archivo de respaldo (.json)
          <input type="file" accept="application/json,.json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) leer(f); e.target.value = ''; }} />
        </label>
        {archivo && <span className="muted" style={{ marginLeft: '.6rem' }}>{archivo}</span>}

        {r && (
          <div style={{ marginTop: '1rem' }}>
            <div className="kpis">
              <div className="kpi acento-4"><div className="v">{r.entregas.length}</div><div className="l">Entregas</div></div>
              <div className="kpi acento-2"><div className="v">{r.eventos.length}</div><div className="l">Movimientos de bins</div></div>
              <div className="kpi acento-7"><div className="v">{r.despachos.length}</div><div className="l">Despachos</div></div>
              <div className="kpi acento-5"><div className="v">{r.asignaciones.length}</div><div className="l">Credenciales</div></div>
            </div>
            <p className="muted" style={{ marginTop: 0 }}>
              Respaldo de <b>{r.nombre}</b> ({autor}) · sacado el {fechaCL(r.creado_en.slice(0, 10))} a las {horaCorta(r.creado_en)}
              {r.entregas.length ? ` · entregas del ${fechaCL([...r.entregas].map((e) => e.fecha).sort()[0])} al ${fechaCL([...r.entregas].map((e) => e.fecha).sort().slice(-1)[0])}` : ''}
            </p>
            <button className="primario" onClick={importar} disabled={trabajando}>{trabajando ? (paso || 'Cargando…') : 'Cargar en la nube'}</button>
          </div>
        )}
        {resultado && (
          <div className={`alerta ${resultado.ok ? 'ok' : 'aviso'}`} style={{ marginTop: '1rem' }}>
            {resultado.lineas.map((l, i) => <div key={i}>{l}</div>)}
          </div>
        )}
      </section>
      <p className="muted" style={{ fontSize: '.85rem' }}>
        Después de cargarlo, el teléfono de origen igual tendrá esos registros como pendientes; al sincronizar se detectan como ya subidos y no se duplican.
      </p>
    </div>
  );
}
