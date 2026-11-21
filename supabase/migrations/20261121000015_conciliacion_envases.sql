-- Conteo de totes en acopio y conciliación contra las entregas registradas en campo.
alter table public.bins add column acopio_envases numeric(10,2);

alter table public.conciliaciones_bin drop constraint conciliaciones_bin_tipo_check;
alter table public.conciliaciones_bin add constraint conciliaciones_bin_tipo_check check (tipo in ('cuartel_distinto','envases_distinto'));

-- Compara campo vs acopio: cuartel y cantidad de envases. Si vuelve a coincidir, cierra solo la pendiente.
create or replace function public.conciliar_bin(p_bin uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  b public.bins%rowtype;
  v_env numeric;
begin
  select * into b from public.bins where id = p_bin;
  if not found or b.origen <> 'campo' or b.estado = 'anulado' then return; end if;

  -- cuartel
  if b.acopio_cuartel_id is not null and b.cuartel_id is not null then
    if b.acopio_cuartel_id is distinct from b.cuartel_id then
      insert into public.conciliaciones_bin(empresa_id, bin_id, codigo, tipo, campo, acopio)
      values (b.empresa_id, b.id, b.codigo, 'cuartel_distinto',
              jsonb_build_object('huerto_id', b.huerto_id, 'cuartel_id', b.cuartel_id, 'variedad_id', b.variedad_id),
              jsonb_build_object('huerto_id', b.acopio_huerto_id, 'cuartel_id', b.acopio_cuartel_id, 'variedad_id', b.acopio_variedad_id))
      on conflict (bin_id, tipo) where estado = 'pendiente' do update set campo = excluded.campo, acopio = excluded.acopio;
    else
      update public.conciliaciones_bin set estado = 'campo', resuelto_en = now(), nota = 'Coincide al sincronizar'
       where bin_id = b.id and tipo = 'cuartel_distinto' and estado = 'pendiente';
    end if;
  end if;

  -- envases (solo cuando el acopio contó)
  if b.acopio_envases is not null then
    select coalesce(sum(cantidad), 0) into v_env from public.entregas where bin_id = b.id and estado = 'A';
    if v_env <> b.acopio_envases then
      insert into public.conciliaciones_bin(empresa_id, bin_id, codigo, tipo, campo, acopio)
      values (b.empresa_id, b.id, b.codigo, 'envases_distinto',
              jsonb_build_object('envases', v_env), jsonb_build_object('envases', b.acopio_envases))
      on conflict (bin_id, tipo) where estado = 'pendiente' do update set campo = excluded.campo, acopio = excluded.acopio;
    else
      update public.conciliaciones_bin set estado = 'campo', resuelto_en = now(), nota = 'Coincide al sincronizar'
       where bin_id = b.id and tipo = 'envases_distinto' and estado = 'pendiente';
    end if;
  end if;
end $$;
revoke execute on function public.conciliar_bin(uuid) from public, anon, authenticated;

-- El conteo de acopio viaja en el evento (datos.envases) de recibir o armar
create or replace function public.tg_evento_bin_envases() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.resultado = 'OK' and new.tipo in ('recibir','armar') and new.bin_aplicado is not null and (new.datos->>'envases') is not null then
    update public.bins set acopio_envases = (new.datos->>'envases')::numeric,
      envases_declarados = case when origen = 'recepcion' then (new.datos->>'envases')::numeric else envases_declarados end
     where id = new.bin_aplicado;
    perform public.conciliar_bin(new.bin_aplicado);
  end if;
  return null;
end $$;
revoke execute on function public.tg_evento_bin_envases() from public, anon, authenticated;
create trigger eventos_bin_envases after insert on public.eventos_bin
  for each row execute function public.tg_evento_bin_envases();

-- Las entregas suben después que los eventos: al llegar o cambiar, se vuelve a conciliar su bin.
-- A nivel de sentencia para no generar diferencias intermedias mientras sube un lote de entregas.
create or replace function public.tg_entregas_concilia() returns trigger
language plpgsql security definer set search_path = public as $$
declare v uuid;
begin
  if tg_op = 'INSERT' then
    for v in select distinct bin_id from nuevas where bin_id is not null loop perform public.conciliar_bin(v); end loop;
  else
    for v in select distinct bin_id from (select bin_id from nuevas union select bin_id from viejas) t where bin_id is not null loop
      perform public.conciliar_bin(v);
    end loop;
  end if;
  return null;
end $$;
revoke execute on function public.tg_entregas_concilia() from public, anon, authenticated;
create trigger entregas_concilia_ins after insert on public.entregas
  referencing new table as nuevas for each statement execute function public.tg_entregas_concilia();
create trigger entregas_concilia_upd after update on public.entregas
  referencing old table as viejas new table as nuevas for each statement execute function public.tg_entregas_concilia();

-- En diferencias de envases no se puede "usar acopio": se corrige anulando o editando entregas
create or replace function public.resolver_conciliacion(p_id uuid, p_opcion text, p_nota text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  c public.conciliaciones_bin%rowtype;
  v_cuartel public.cuarteles%rowtype;
  e record;
  n int := 0;
begin
  if not public.es_admin() then raise exception 'Solo administradores pueden conciliar'; end if;
  select * into c from public.conciliaciones_bin where id = p_id and empresa_id = public.mi_empresa() for update;
  if not found then raise exception 'Conciliación no encontrada'; end if;
  if c.estado <> 'pendiente' then raise exception 'Ya fue resuelta'; end if;
  if p_opcion not in ('campo','acopio','descartar') then raise exception 'Opción inválida'; end if;
  if p_opcion = 'acopio' and c.tipo = 'envases_distinto' then
    raise exception 'Para ajustar la cantidad, anula o edita la entrega que sobra o falta';
  end if;

  if p_opcion = 'acopio' then
    select * into v_cuartel from public.cuarteles where id = (c.acopio->>'cuartel_id')::uuid and empresa_id = c.empresa_id;
    if not found then raise exception 'El cuartel de acopio no existe'; end if;
    update public.bins set huerto_id = v_cuartel.huerto_id, cuartel_id = v_cuartel.id,
      variedad_id = coalesce(v_cuartel.variedad_id, variedad_id), updated_at = now()
     where id = c.bin_id;
    for e in select id from public.entregas where bin_id = c.bin_id and estado <> 'X' and cuartel_id is distinct from v_cuartel.id loop
      perform public.editar_entrega(e.id, jsonb_build_object('cuartel_id', v_cuartel.id),
        coalesce(nullif(trim(p_nota),''), 'Conciliación de bin ' || c.codigo || ': cuartel según acopio'));
      n := n + 1;
    end loop;
  end if;

  update public.conciliaciones_bin set estado = case p_opcion when 'descartar' then 'descartada' else p_opcion end,
    resuelto_en = now(), resuelto_por = auth.uid(), nota = nullif(trim(p_nota),'')
   where id = p_id;
  return jsonb_build_object('entregas_corregidas', n);
end $$;
revoke execute on function public.resolver_conciliacion(uuid,text,text) from public, anon;
grant execute on function public.resolver_conciliacion(uuid,text,text) to authenticated;

-- v_bins: agrega el conteo de acopio al final
create or replace view public.v_bins with (security_invoker = true) as
select b.id, b.empresa_id, b.codigo, b.origen, b.huerto_id, b.cuartel_id, b.variedad_id, b.envase_id, b.cuadrilla_id,
       b.envases_declarados, b.abierto_en, b.abierto_por, b.cerrado_en, b.recibido_en, b.recibido_por, b.calidad,
       b.observacion, b.fotos, b.camara_id, b.camara_inicio, b.camara_fin, b.despacho_id, b.despachado_en, b.estado,
       b.lat, b.lng, b.updated_at,
       h.nombre as huerto, c.nombre as cuartel, va.nombre as variedad, es.nombre as especie, va.especie_id,
       en.nombre as envase, cu.nombre as cuadrilla,
       pa.nombre as abierto_por_nombre, pr.nombre as recibido_por_nombre,
       ca.nombre as camara, ca.minutos_objetivo, ca.minutos_alerta,
       de.numero as despacho_numero, de.patente, de.guia,
       coalesce(e.envases, b.envases_declarados, 0) as envases,
       coalesce(e.kilos, b.envases_declarados * en.kilos_referencia, 0) as kilos,
       coalesce(e.trabajadores, 0) as trabajadores,
       (coalesce(b.abierto_en, b.recibido_en) at time zone 'America/Santiago')::date as fecha,
       case when b.camara_inicio is not null
            then round(extract(epoch from (coalesce(b.camara_fin, now()) - b.camara_inicio)) / 60) end as minutos_camara,
       case when b.cerrado_en is not null and b.recibido_en is not null and b.origen = 'campo'
            then round(extract(epoch from (b.recibido_en - b.cerrado_en)) / 60) end as minutos_a_acopio,
       b.acopio_huerto_id, b.acopio_cuartel_id, ac.nombre as acopio_cuartel,
       coalesce(e.despues_recepcion, 0) as entregas_despues_recepcion,
       b.acopio_envases
  from public.bins b
  left join public.huertos h on h.id = b.huerto_id
  left join public.cuarteles c on c.id = b.cuartel_id
  left join public.cuarteles ac on ac.id = b.acopio_cuartel_id
  left join public.variedades va on va.id = b.variedad_id
  left join public.especies es on es.id = va.especie_id
  left join public.envases en on en.id = b.envase_id
  left join public.cuadrillas cu on cu.id = b.cuadrilla_id
  left join public.perfiles pa on pa.user_id = b.abierto_por
  left join public.perfiles pr on pr.user_id = b.recibido_por
  left join public.camaras ca on ca.id = b.camara_id
  left join public.despachos de on de.id = b.despacho_id
  left join lateral (
    select sum(x.cantidad) as envases, sum(x.kilos_estimados) as kilos, count(distinct x.trabajador_id) as trabajadores,
           count(*) filter (where b.recibido_en is not null and x.leido_en > b.recibido_en) as despues_recepcion
      from public.entregas x where x.bin_id = b.id and x.estado = 'A'
  ) e on true;
