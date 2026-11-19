'use client';
import { useState } from 'react';
import Crud from '@/components/Crud';
import { useTabla } from '@/lib/datos';

const TABS = ['Huertos', 'Cuarteles', 'Especies', 'Variedades', 'Envases', 'Calidades', 'Turnos', 'Contratistas', 'Cuadrillas'] as const;

export default function Maestros() {
  const [tab, setTab] = useState<(typeof TABS)[number]>('Huertos');
  const huertos = useTabla<any>('huertos', 'id,nombre', 'nombre');
  const especies = useTabla<any>('especies', 'id,nombre', 'nombre');
  const variedades = useTabla<any>('variedades', 'id,nombre,especie_id', 'nombre');
  const perfiles = useTabla<any>('perfiles', 'user_id,nombre', 'nombre');

  const op = (l: any[], k = 'id', t = 'nombre') => l.map((x) => ({ v: x[k], t: x[t] }));
  const opVariedades = variedades.filas.map((v) => ({
    v: v.id,
    t: `${v.nombre} (${especies.filas.find((e) => e.id === v.especie_id)?.nombre ?? ''})`,
  }));

  return (
    <div>
      <h1>Huertos y maestros</h1>
      <div className="tabs">
        {TABS.map((t) => (
          <button key={t} className={tab === t ? 'activo' : ''} onClick={() => setTab(t)}>{t}</button>
        ))}
      </div>

      {tab === 'Huertos' && (
        <Crud key="h" tabla="huertos" titulo="Huertos" orden="orden"
          campos={[{ k: 'nombre', t: 'Nombre', req: true }, { k: 'orden', t: 'Orden', tipo: 'number', ancho: 100, def: 0 }]} />
      )}
      {tab === 'Cuarteles' && (
        <Crud key="c" tabla="cuarteles" titulo="Cuarteles"
          ayuda="Cada cuartel pertenece a un huerto y tiene una variedad. En terreno el jefe elige el cuartel donde está cosechando."
          campos={[
            { k: 'huerto_id', t: 'Huerto', tipo: 'select', opciones: op(huertos.filas), req: true },
            { k: 'nombre', t: 'Cuartel', req: true },
            { k: 'variedad_id', t: 'Variedad', tipo: 'select', opciones: opVariedades },
            { k: 'superficie_ha', t: 'Superficie (ha)', tipo: 'number', ancho: 130 },
          ]} />
      )}
      {tab === 'Especies' && (
        <Crud key="e" tabla="especies" titulo="Especies" campos={[{ k: 'nombre', t: 'Nombre', req: true }]} />
      )}
      {tab === 'Variedades' && (
        <Crud key="v" tabla="variedades" titulo="Variedades"
          campos={[
            { k: 'especie_id', t: 'Especie', tipo: 'select', opciones: op(especies.filas), req: true },
            { k: 'nombre', t: 'Variedad', req: true },
          ]} />
      )}
      {tab === 'Envases' && (
        <Crud key="en" tabla="envases" titulo="Envases"
          ayuda="Sin balanza, los kilos se estiman como cantidad de envases × kilos de referencia."
          campos={[
            { k: 'nombre', t: 'Nombre', req: true },
            { k: 'alias', t: 'Alias', ancho: 120 },
            { k: 'kilos_referencia', t: 'Kilos referencia', tipo: 'number', ancho: 150, def: 0 },
          ]} />
      )}
      {tab === 'Calidades' && (
        <Crud key="ca" tabla="calidades" titulo="Calidades" orden="orden"
          campos={[{ k: 'nombre', t: 'Nombre', req: true }, { k: 'alias', t: 'Alias', ancho: 120 }, { k: 'orden', t: 'Orden', tipo: 'number', ancho: 100, def: 0 }]} />
      )}
      {tab === 'Turnos' && (
        <Crud key="t" tabla="turnos" titulo="Turnos" orden="orden"
          campos={[{ k: 'nombre', t: 'Nombre', req: true }, { k: 'orden', t: 'Orden', tipo: 'number', ancho: 100, def: 0 }]} />
      )}
      {tab === 'Contratistas' && (
        <Crud key="co" tabla="contratistas" titulo="Contratistas"
          campos={[{ k: 'nombre', t: 'Nombre', req: true }, { k: 'rut', t: 'RUT', ancho: 160 }]} />
      )}
      {tab === 'Cuadrillas' && (
        <Crud key="cu" tabla="cuadrillas" titulo="Cuadrillas"
          ayuda="Opcional. Sirve para agrupar trabajadores bajo un jefe y filtrar reportes."
          campos={[
            { k: 'nombre', t: 'Nombre', req: true },
            { k: 'huerto_id', t: 'Huerto', tipo: 'select', opciones: op(huertos.filas) },
            { k: 'jefe_user_id', t: 'Jefe', tipo: 'select', opciones: op(perfiles.filas, 'user_id') },
          ]} />
      )}
    </div>
  );
}
