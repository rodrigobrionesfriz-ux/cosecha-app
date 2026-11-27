-- Importa un respaldo de emergencia sacado desde un teléfono (archivo JSON de la app).
-- Lo usa el administrador cuando un teléfono no pudo sincronizar. Conserva el autor original
-- (jefe u operador de acopio) y es idempotente: lo que ya estaba en la nube se omite.
-- Las credenciales asignadas sin señal se procesan antes desde el panel con asignar_credencial().
create or replace function public.importar_respaldo(p jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_emp uuid := public.mi_empresa();
  v_usuario uuid;
  n_pk int := 0; n_pl int := 0; n_desp int := 0; n_ent int := 0; n_ev int := 0; n int;
  x jsonb;
begin
  if not public.es_admin() then raise exception 'Solo administradores pueden importar respaldos'; end if;
  if p->>'tipo' is distinct from 'qsecha-respaldo' then raise exception 'El archivo no es un respaldo de QSecha'; end if;
  if (p->>'empresa_id')::uuid is distinct from v_emp then raise exception 'El respaldo es de otra empresa'; end if;
  v_usuario := nullif(p->>'usuario', '')::uuid;
  if v_usuario is null or not exists (select 1 from public.perfiles where user_id = v_usuario and empresa_id = v_emp) then
    raise exception 'El usuario del respaldo no pertenece a esta empresa';
  end if;

  -- destinos agregados en el teléfono
  for x in select * from jsonb_array_elements(coalesce(p->'destinos'->'packings', '[]')) loop
    insert into public.packings (id, empresa_id, nombre, rut) values ((x->>'id')::uuid, v_emp, x->>'nombre', nullif(x->>'rut', ''))
    on conflict do nothing;
    get diagnostics n = row_count; n_pk := n_pk + n;
  end loop;
  for x in select * from jsonb_array_elements(coalesce(p->'destinos'->'plantas', '[]')) loop
    insert into public.packing_plantas (id, empresa_id, packing_id, nombre, direccion, comuna)
    values ((x->>'id')::uuid, v_emp, (x->>'packing_id')::uuid, x->>'nombre', nullif(x->>'direccion', ''), nullif(x->>'comuna', ''))
    on conflict do nothing;
    get diagnostics n = row_count; n_pl := n_pl + n;
  end loop;

  -- despachos (el trigger registra el camión)
  for x in select * from jsonb_array_elements(coalesce(p->'despachos', '[]')) loop
    insert into public.despachos (id, empresa_id, patente, carro, transportista, guia, destino, chofer, packing_id, planta_id, estado, abierto_en, cerrado_en, creado_por)
    values ((x->>'id')::uuid, v_emp, x->>'patente', nullif(x->>'carro', ''), nullif(x->>'transportista', ''), nullif(x->>'guia', ''), nullif(x->>'destino', ''),
            nullif(x->>'chofer', ''), nullif(x->>'packing_id', '')::uuid, nullif(x->>'planta_id', '')::uuid, coalesce(x->>'estado', 'abierto'),
            (x->>'abierto_en')::timestamptz, nullif(x->>'cerrado_en', '')::timestamptz, coalesce(nullif(x->>'usuario', '')::uuid, v_usuario))
    on conflict (id) do update set
      estado = excluded.estado, cerrado_en = coalesce(excluded.cerrado_en, despachos.cerrado_en),
      guia = coalesce(excluded.guia, despachos.guia), carro = coalesce(excluded.carro, despachos.carro);
    n_desp := n_desp + 1;
  end loop;

  -- movimientos de bins, en orden (el trigger los valida igual que desde el teléfono)
  for x in select e from jsonb_array_elements(coalesce(p->'eventos', '[]')) e order by e->>'hecho_en' loop
    insert into public.eventos_bin (id, empresa_id, codigo, tipo, bin_id, datos, hecho_en, hecho_por, dispositivo)
    values ((x->>'id')::uuid, v_emp, x->>'codigo', x->>'tipo', nullif(x->>'bin_id', '')::uuid, coalesce(x->'datos', '{}'),
            (x->>'hecho_en')::timestamptz, coalesce(nullif(x->>'usuario', '')::uuid, v_usuario), x->>'dispositivo')
    on conflict (id) do nothing;
    get diagnostics n = row_count; n_ev := n_ev + n;
  end loop;

  -- entregas (las de trabajadores creados sin señal llegan ya resueltas desde el panel)
  for x in select * from jsonb_array_elements(coalesce(p->'entregas', '[]')) loop
    if coalesce(x->>'trabajador_id', '') !~ '^[0-9a-f-]{36}$' then continue; end if;
    insert into public.entregas (id, empresa_id, huerto_id, cuartel_id, variedad_id, envase_id, calidad_id, turno_id, contratista_id, cuadrilla_id,
      trabajador_id, codigo_credencial, codigo_caja, cantidad, kilos_estimados, leido_en, fecha, lat, lng, dispositivo, jefe_user_id, bin_id, operador_id)
    values ((x->>'id')::uuid, v_emp, (x->>'huerto_id')::uuid, (x->>'cuartel_id')::uuid, nullif(x->>'variedad_id', '')::uuid, (x->>'envase_id')::uuid,
      nullif(x->>'calidad_id', '')::uuid, nullif(x->>'turno_id', '')::uuid, nullif(x->>'contratista_id', '')::uuid, nullif(x->>'cuadrilla_id', '')::uuid,
      (x->>'trabajador_id')::uuid, x->>'codigo_credencial', nullif(x->>'codigo_caja', ''), (x->>'cantidad')::numeric, (x->>'kilos_estimados')::numeric,
      (x->>'leido_en')::timestamptz, (x->>'fecha')::date, nullif(x->>'lat', '')::numeric, nullif(x->>'lng', '')::numeric, x->>'dispositivo',
      coalesce(nullif(x->>'jefe_user_id', '')::uuid, v_usuario), nullif(x->>'bin_id', '')::uuid, nullif(x->>'operador_id', '')::uuid)
    on conflict (id) do nothing;
    get diagnostics n = row_count; n_ent := n_ent + n;
  end loop;

  return jsonb_build_object('packings', n_pk, 'plantas', n_pl, 'despachos', n_desp, 'eventos', n_ev, 'entregas', n_ent);
end $$;
revoke execute on function public.importar_respaldo(jsonb) from public, anon;
grant execute on function public.importar_respaldo(jsonb) to authenticated;
