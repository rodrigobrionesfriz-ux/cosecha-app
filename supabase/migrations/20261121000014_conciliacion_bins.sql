-- =====================================================================
-- Conciliación de bins entre acopio y campo (sincronización bajo demanda)
--
-- El acopio declara huerto y cuartel al recibir. Cuando sube el teléfono del
-- jefe, el dato de campo manda (las entregas ya tienen su cuartel) y si no
-- coincide con lo declarado en acopio queda una conciliación pendiente para
-- que el administrador confirme el dato de campo o aplique el de acopio.
-- =====================================================================

alter table public.bins
  add column acopio_huerto_id uuid references public.huertos(id),
  add column acopio_cuartel_id uuid references public.cuarteles(id),
  add column acopio_variedad_id uuid references public.variedades(id);

create table public.conciliaciones_bin (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id),
  bin_id uuid not null,                 -- sin FK: el id del bin cambia al unir campo con recepción
  codigo text not null,
  tipo text not null check (tipo in ('cuartel_distinto')),
  campo jsonb not null default '{}'::jsonb,   -- {huerto_id, cuartel_id, variedad_id}
  acopio jsonb not null default '{}'::jsonb,
  estado text not null default 'pendiente' check (estado in ('pendiente','campo','acopio','descartada')),
  creado_en timestamptz not null default now(),
  resuelto_en timestamptz,
  resuelto_por uuid references public.perfiles(user_id),
  nota text
);
create unique index conciliaciones_pend_uq on public.conciliaciones_bin(bin_id, tipo) where estado = 'pendiente';
create index conciliaciones_emp_idx on public.conciliaciones_bin(empresa_id, estado, creado_en);
alter table public.conciliaciones_bin enable row level security;
create policy conciliaciones_sel on public.conciliaciones_bin for select to authenticated using (empresa_id = public.mi_empresa());

-- Registra diferencia de cuartel entre campo y acopio (si la hay)
create or replace function public.conciliar_bin(p_bin uuid) returns void
language plpgsql security definer set search_path = public as $$
declare b public.bins%rowtype;
begin
  select * into b from public.bins where id = p_bin;
  if not found or b.acopio_cuartel_id is null or b.cuartel_id is null then return; end if;
  if b.origen <> 'campo' then return; end if;
  if b.acopio_cuartel_id is distinct from b.cuartel_id then
    insert into public.conciliaciones_bin(empresa_id, bin_id, codigo, tipo, campo, acopio)
    values (b.empresa_id, b.id, b.codigo, 'cuartel_distinto',
            jsonb_build_object('huerto_id', b.huerto_id, 'cuartel_id', b.cuartel_id, 'variedad_id', b.variedad_id),
            jsonb_build_object('huerto_id', b.acopio_huerto_id, 'cuartel_id', b.acopio_cuartel_id, 'variedad_id', b.acopio_variedad_id))
    on conflict (bin_id, tipo) where estado = 'pendiente' do update set campo = excluded.campo, acopio = excluded.acopio;
  else
    update public.conciliaciones_bin set estado = 'campo', resuelto_en = now(), nota = 'Coincide al sincronizar'
     where bin_id = b.id and estado = 'pendiente';
  end if;
end $$;
revoke execute on function public.conciliar_bin(uuid) from public, anon, authenticated;

-- ---------- Trigger de eventos con conciliación ----------
create or replace function public.tg_evento_bin() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_rol text;
  b public.bins%rowtype;
  r public.bins%rowtype;
  d jsonb := coalesce(new.datos, '{}'::jsonb);
  v_desp public.despachos%rowtype;
  v_id uuid;
  v_activo boolean;
  v_fotos text[] := coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(new.datos->'fotos','[]'::jsonb)) x), '{}');
begin
  new.codigo := upper(trim(new.codigo));
  select rol into v_rol from public.perfiles where user_id = new.hecho_por and empresa_id = new.empresa_id and activo;
  if v_rol is null then new.resultado := 'SP'; new.mensaje := 'Usuario sin perfil activo'; return new; end if;
  if new.tipo in ('abrir','cerrar') and v_rol not in ('admin','jefe','acopio') then
    new.resultado := 'SP'; new.mensaje := 'Sin permiso'; return new;
  end if;
  if new.tipo in ('armar','recibir','camara_entrada','camara_salida','despachar') and v_rol not in ('admin','acopio') then
    new.resultado := 'SP'; new.mensaje := 'Solo acopio o administración'; return new;
  end if;
  if new.tipo = 'anular' and v_rol <> 'admin' then
    new.resultado := 'SP'; new.mensaje := 'Solo administración puede anular'; return new;
  end if;
  if not exists (select 1 from public.tarjetas t where t.empresa_id = new.empresa_id and t.codigo = new.codigo and t.tipo = 'L' and t.estado <> 'anulada') then
    new.resultado := 'NE'; new.mensaje := 'La etiqueta no es un bin de la empresa'; return new;
  end if;

  select * into b from public.bins
   where empresa_id = new.empresa_id and codigo = new.codigo and estado not in ('despachado','anulado')
   for update;
  v_activo := found;

  -- ---------------- abrir (campo) ----------------
  if new.tipo = 'abrir' then
    if new.bin_id is null then new.resultado := 'DI'; new.mensaje := 'Falta id del bin'; return new; end if;
    if exists (select 1 from public.bins x where x.id = new.bin_id) then
      new.resultado := 'OK'; new.mensaje := 'Ya registrado'; new.bin_aplicado := new.bin_id; return new;
    end if;
    -- El acopio lo recibió antes de que subiera la apertura del campo: se unen (aunque ya esté en cámara o despachado)
    select * into r from public.bins
     where empresa_id = new.empresa_id and codigo = new.codigo and origen = 'recepcion' and abierto_en is null
       and estado <> 'anulado' and recibido_en >= new.hecho_en
     order by recibido_en limit 1 for update;
    if found then
      update public.bins set id = new.bin_id, origen = 'campo',
        huerto_id = (d->>'huerto_id')::uuid, cuartel_id = (d->>'cuartel_id')::uuid,
        variedad_id = (d->>'variedad_id')::uuid, envase_id = (d->>'envase_id')::uuid,
        cuadrilla_id = (d->>'cuadrilla_id')::uuid,
        abierto_en = new.hecho_en, abierto_por = new.hecho_por,
        lat = (d->>'lat')::numeric, lng = (d->>'lng')::numeric, updated_at = now()
       where id = r.id;
      perform public.conciliar_bin(new.bin_id);
      new.resultado := 'OK'; new.mensaje := 'Unido a la recepción ya registrada'; new.bin_aplicado := new.bin_id; return new;
    end if;
    if v_activo then
      new.resultado := 'EA'; new.mensaje := 'El bin ya está en uso (' || b.estado || ')'; new.bin_aplicado := b.id; return new;
    end if;
    insert into public.bins(id, empresa_id, codigo, origen, huerto_id, cuartel_id, variedad_id, envase_id, cuadrilla_id,
                            abierto_en, abierto_por, estado, lat, lng)
    values (new.bin_id, new.empresa_id, new.codigo, 'campo', (d->>'huerto_id')::uuid, (d->>'cuartel_id')::uuid,
            (d->>'variedad_id')::uuid, (d->>'envase_id')::uuid, (d->>'cuadrilla_id')::uuid,
            new.hecho_en, new.hecho_por, 'abierto', (d->>'lat')::numeric, (d->>'lng')::numeric);
    new.resultado := 'OK'; new.bin_aplicado := new.bin_id; return new;
  end if;

  -- ---------------- cerrar (campo): por id del bin, aunque el acopio ya lo haya recibido ----------------
  if new.tipo = 'cerrar' then
    if new.bin_id is not null then
      select * into r from public.bins where id = new.bin_id and empresa_id = new.empresa_id for update;
      if found then b := r; v_activo := true; end if;
    end if;
    if not v_activo then new.resultado := 'NF'; new.mensaje := 'No hay un bin activo con esa etiqueta'; return new; end if;
    if b.estado = 'abierto' then
      update public.bins set cerrado_en = new.hecho_en, estado = 'cerrado', updated_at = now() where id = b.id;
    elsif b.cerrado_en is null or b.cerrado_en > new.hecho_en then
      update public.bins set cerrado_en = new.hecho_en, updated_at = now() where id = b.id;
    end if;
    new.resultado := 'OK'; new.bin_aplicado := b.id; return new;
  end if;

  -- ---------------- armar (acopio, bandejas sueltas) ----------------
  if new.tipo = 'armar' then
    if v_activo then new.resultado := 'EA'; new.mensaje := 'El bin ya está en uso (' || b.estado || ')'; new.bin_aplicado := b.id; return new; end if;
    if exists (select 1 from public.bins x where x.id = new.bin_id) then
      new.resultado := 'OK'; new.mensaje := 'Ya registrado'; new.bin_aplicado := new.bin_id; return new;
    end if;
    if coalesce((d->>'envases')::numeric, 0) <= 0 then new.resultado := 'DI'; new.mensaje := 'Indica cuántos envases tiene el bin'; return new; end if;
    insert into public.bins(id, empresa_id, codigo, origen, huerto_id, cuartel_id, variedad_id, envase_id, cuadrilla_id,
                            acopio_huerto_id, acopio_cuartel_id, acopio_variedad_id,
                            envases_declarados, abierto_en, abierto_por, cerrado_en, recibido_en, recibido_por,
                            calidad, observacion, fotos, estado)
    values (coalesce(new.bin_id, gen_random_uuid()), new.empresa_id, new.codigo, 'acopio', (d->>'huerto_id')::uuid, (d->>'cuartel_id')::uuid,
            (d->>'variedad_id')::uuid, (d->>'envase_id')::uuid, (d->>'cuadrilla_id')::uuid,
            (d->>'huerto_id')::uuid, (d->>'cuartel_id')::uuid, (d->>'variedad_id')::uuid,
            (d->>'envases')::numeric, new.hecho_en, new.hecho_por, new.hecho_en, new.hecho_en, new.hecho_por,
            coalesce(d->'calidad', '{}'::jsonb), nullif(d->>'observacion',''), v_fotos, 'recibido')
    returning id into v_id;
    new.resultado := 'OK'; new.bin_aplicado := v_id; return new;
  end if;

  -- ---------------- recibir (acopio declara huerto y cuartel) ----------------
  if new.tipo = 'recibir' then
    if (d->>'cuartel_id') is null then new.resultado := 'DI'; new.mensaje := 'Falta el huerto y cuartel del bin'; return new; end if;
    if not v_activo then
      -- Aún no sube el teléfono del jefe: el bin queda con lo declarado en acopio hasta conciliar
      insert into public.bins(id, empresa_id, codigo, origen, huerto_id, cuartel_id, variedad_id,
                              acopio_huerto_id, acopio_cuartel_id, acopio_variedad_id,
                              recibido_en, recibido_por, calidad, observacion, fotos, estado)
      values (coalesce(new.bin_id, gen_random_uuid()), new.empresa_id, new.codigo, 'recepcion',
              (d->>'huerto_id')::uuid, (d->>'cuartel_id')::uuid, (d->>'variedad_id')::uuid,
              (d->>'huerto_id')::uuid, (d->>'cuartel_id')::uuid, (d->>'variedad_id')::uuid,
              new.hecho_en, new.hecho_por, coalesce(d->'calidad', '{}'::jsonb), nullif(d->>'observacion',''), v_fotos, 'recibido')
      returning id into v_id;
      new.resultado := 'OK'; new.mensaje := 'Recibido; se concilia cuando sincronice el jefe'; new.bin_aplicado := v_id; return new;
    end if;
    if b.estado not in ('abierto','cerrado') then
      new.resultado := 'DR'; new.mensaje := 'El bin ya fue recibido (' || b.estado || ')'; new.bin_aplicado := b.id; return new;
    end if;
    update public.bins set cerrado_en = coalesce(cerrado_en, new.hecho_en), recibido_en = new.hecho_en, recibido_por = new.hecho_por,
      acopio_huerto_id = (d->>'huerto_id')::uuid, acopio_cuartel_id = (d->>'cuartel_id')::uuid, acopio_variedad_id = (d->>'variedad_id')::uuid,
      calidad = coalesce(d->'calidad', '{}'::jsonb), observacion = nullif(d->>'observacion',''), fotos = v_fotos,
      estado = 'recibido', updated_at = now()
     where id = b.id;
    perform public.conciliar_bin(b.id);
    new.resultado := 'OK';
    new.mensaje := case
      when b.cuartel_id is distinct from (d->>'cuartel_id')::uuid then 'Recibido. El cuartel no coincide con el de campo: queda para revisión'
      when b.estado = 'abierto' then 'Recibido (el bin seguía abierto en campo)' end;
    new.bin_aplicado := b.id; return new;
  end if;

  if not v_activo then new.resultado := 'NF'; new.mensaje := 'No hay un bin activo con esa etiqueta'; return new; end if;
  new.bin_aplicado := b.id;

  if new.tipo = 'camara_entrada' then
    if b.estado in ('abierto','cerrado') then new.resultado := 'NR'; new.mensaje := 'Primero hay que recibir el bin'; return new; end if;
    if b.estado = 'en_camara' then new.resultado := 'EC'; new.mensaje := 'El bin ya está en cámara'; return new; end if;
    if (d->>'camara_id') is null then new.resultado := 'DI'; new.mensaje := 'Falta la cámara'; return new; end if;
    update public.bins set camara_id = (d->>'camara_id')::uuid, camara_inicio = new.hecho_en, camara_fin = null,
      estado = 'en_camara', updated_at = now() where id = b.id;
    new.resultado := 'OK'; return new;
  end if;

  if new.tipo = 'camara_salida' then
    if b.estado <> 'en_camara' then new.resultado := 'NC'; new.mensaje := 'El bin no está en cámara'; return new; end if;
    update public.bins set camara_fin = new.hecho_en, estado = 'enfriado', updated_at = now() where id = b.id;
    new.resultado := 'OK'; return new;
  end if;

  if new.tipo = 'despachar' then
    if b.estado in ('abierto','cerrado') then new.resultado := 'NR'; new.mensaje := 'Primero hay que recibir el bin'; return new; end if;
    select * into v_desp from public.despachos where id = (d->>'despacho_id')::uuid and empresa_id = new.empresa_id;
    if not found then new.resultado := 'ND'; new.mensaje := 'Despacho no encontrado'; return new; end if;
    if v_desp.estado = 'anulado' then new.resultado := 'ND'; new.mensaje := 'El despacho está anulado'; return new; end if;
    update public.bins set despacho_id = v_desp.id, despachado_en = new.hecho_en,
      camara_fin = case when estado = 'en_camara' then new.hecho_en else camara_fin end,
      estado = 'despachado', updated_at = now() where id = b.id;
    new.resultado := 'OK'; return new;
  end if;

  if new.tipo = 'anular' then
    update public.bins set estado = 'anulado', observacion = coalesce(observacion || ' | ', '') || 'Anulado: ' || coalesce(d->>'motivo',''), updated_at = now() where id = b.id;
    update public.conciliaciones_bin set estado = 'descartada', resuelto_en = now(), resuelto_por = new.hecho_por, nota = 'Bin anulado'
     where bin_id = b.id and estado = 'pendiente';
    new.resultado := 'OK'; return new;
  end if;

  new.resultado := 'TI'; new.mensaje := 'Tipo de evento desconocido';
  return new;
end $$;
revoke execute on function public.tg_evento_bin() from public, anon, authenticated;

-- ---------- Resolución por el administrador ----------
-- p_opcion: 'campo' (confirma lo del jefe), 'acopio' (aplica huerto/cuartel de acopio al bin y a sus entregas), 'descartar'
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

-- ---------- Vistas para el panel ----------
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
       coalesce(e.despues_recepcion, 0) as entregas_despues_recepcion
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

create or replace view public.v_conciliaciones with (security_invoker = true) as
select k.*, b.estado as estado_bin, b.recibido_en, b.abierto_en,
       hc.nombre as campo_huerto, cc.nombre as campo_cuartel, ha.nombre as acopio_huerto, ca.nombre as acopio_cuartel,
       pa.nombre as jefe, pr.nombre as recibido_por_nombre, ps.nombre as resuelto_por_nombre,
       (select count(*) from public.entregas x where x.bin_id = k.bin_id and x.estado = 'A') as entregas,
       (select coalesce(sum(x.cantidad),0) from public.entregas x where x.bin_id = k.bin_id and x.estado = 'A') as envases
  from public.conciliaciones_bin k
  left join public.bins b on b.id = k.bin_id
  left join public.huertos hc on hc.id = (k.campo->>'huerto_id')::uuid
  left join public.cuarteles cc on cc.id = (k.campo->>'cuartel_id')::uuid
  left join public.huertos ha on ha.id = (k.acopio->>'huerto_id')::uuid
  left join public.cuarteles ca on ca.id = (k.acopio->>'cuartel_id')::uuid
  left join public.perfiles pa on pa.user_id = b.abierto_por
  left join public.perfiles pr on pr.user_id = b.recibido_por
  left join public.perfiles ps on ps.user_id = k.resuelto_por;
