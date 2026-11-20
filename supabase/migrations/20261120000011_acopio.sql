-- =====================================================================
-- Acopio: bins con etiqueta BC-L, recepción con calidad, cámara de frío
-- y despacho en camión. Inspirado en HubCrop Stage (labores por etapa).
--
-- Los teléfonos (campo y acopio) no escriben directo en "bins": envían
-- eventos idempotentes a "eventos_bin" y un trigger los valida y aplica.
-- Así funciona sin señal y el orden de llegada no rompe la trazabilidad.
-- Un bin físico se reutiliza: cada vuelta es una fila nueva en "bins";
-- solo puede haber una vuelta activa por código.
-- =====================================================================

-- ---------- Rol acopio ----------
alter table public.perfiles drop constraint perfiles_rol_check;
alter table public.perfiles add constraint perfiles_rol_check check (rol in ('admin','jefe','consulta','acopio'));
alter table public.invitaciones drop constraint invitaciones_rol_check;
alter table public.invitaciones add constraint invitaciones_rol_check check (rol in ('admin','jefe','consulta','acopio'));

-- ---------- Etiquetas de bin (tipo L) ----------
alter table public.tarjetas drop constraint tarjetas_tipo_check;
alter table public.tarjetas add constraint tarjetas_tipo_check check (tipo in ('W','B','L'));
alter table public.lotes_impresion drop constraint lotes_impresion_tipo_check;
alter table public.lotes_impresion add constraint lotes_impresion_tipo_check check (tipo in ('W','B','L'));

create or replace function public.generar_tarjetas(p_tipo char, p_cantidad int, p_descripcion text default null)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_emp uuid := public.mi_empresa();
  v_cod smallint;
  v_desde bigint; v_hasta bigint; v_lote uuid;
begin
  if not public.es_admin() then raise exception 'Solo administradores pueden generar tarjetas'; end if;
  if p_tipo not in ('W','B','L') then raise exception 'Tipo inválido'; end if;
  if p_cantidad < 1 or p_cantidad > 5000 then raise exception 'Cantidad entre 1 y 5000'; end if;

  select codigo into v_cod from public.empresas where id = v_emp;

  insert into public.correlativos(empresa_id, tipo, ultimo) values (v_emp, p_tipo, 0)
    on conflict (empresa_id, tipo) do nothing;
  update public.correlativos set ultimo = ultimo + p_cantidad
    where empresa_id = v_emp and tipo = p_tipo
    returning ultimo - p_cantidad + 1, ultimo into v_desde, v_hasta;

  insert into public.lotes_impresion(empresa_id, tipo, descripcion, cantidad, desde, hasta)
    values (v_emp, p_tipo, p_descripcion, p_cantidad, v_desde, v_hasta) returning id into v_lote;

  insert into public.tarjetas(empresa_id, codigo, tipo, correlativo, lote_id)
  select v_emp,
         'BC-' || p_tipo || '-' || lpad(v_cod::text, 2, '0') || lpad(n::text, 8, '0'),
         p_tipo, n, v_lote
    from generate_series(v_desde, v_hasta) n;

  return v_lote;
end $$;

-- ---------- Configuración por huerto ----------
alter table public.config_huerto
  add column usa_bins boolean not null default false,          -- el jefe debe tener un bin abierto para registrar
  add column max_envases_bin int not null default 0,            -- 0 = sin límite
  add column exige_calidad_recepcion boolean not null default false;

-- ---------- Maestros de acopio ----------
create table public.camaras (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id),
  nombre text not null,
  minutos_objetivo int not null default 0,   -- duración esperada del enfriado
  minutos_alerta int not null default 0,     -- alerta si el bin lleva más que esto (0 = sin alerta)
  activo boolean not null default true,
  updated_at timestamptz not null default now(),
  unique (empresa_id, nombre)
);

create table public.parametros_calidad (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id),
  especie_id uuid references public.especies(id),   -- null = todas
  nombre text not null,
  unidad text,
  tipo text not null default 'numero' check (tipo in ('numero','entero','si_no','opcion')),
  opciones text[] not null default '{}',
  minimo numeric,
  maximo numeric,
  obligatorio boolean not null default false,
  orden int not null default 0,
  activo boolean not null default true,
  updated_at timestamptz not null default now(),
  unique (empresa_id, nombre)
);

-- ---------- Despachos (lote de bins en un camión) ----------
create table public.despachos (
  id uuid primary key,                         -- generado en el teléfono
  empresa_id uuid not null references public.empresas(id),
  numero bigint generated always as identity,
  patente text,
  guia text,
  destino text,
  chofer text,
  observacion text,
  estado text not null default 'abierto' check (estado in ('abierto','cerrado','anulado')),
  abierto_en timestamptz not null default now(),
  cerrado_en timestamptz,
  creado_por uuid default auth.uid() references public.perfiles(user_id),
  updated_at timestamptz not null default now()
);

-- ---------- Bins ----------
create table public.bins (
  id uuid primary key,                         -- generado en el teléfono que lo abrió
  empresa_id uuid not null references public.empresas(id),
  codigo text not null,
  origen text not null check (origen in ('campo','acopio','recepcion')), -- recepcion = llegó sin registro de campo
  huerto_id uuid references public.huertos(id),
  cuartel_id uuid references public.cuarteles(id),
  variedad_id uuid references public.variedades(id),
  envase_id uuid references public.envases(id),
  cuadrilla_id uuid references public.cuadrillas(id),
  envases_declarados numeric(10,2),            -- bins armados en acopio con bandejas sueltas
  abierto_en timestamptz,
  abierto_por uuid references public.perfiles(user_id),
  cerrado_en timestamptz,
  recibido_en timestamptz,
  recibido_por uuid references public.perfiles(user_id),
  calidad jsonb not null default '{}'::jsonb,  -- {parametro_id: valor}
  observacion text,
  fotos text[] not null default '{}',          -- rutas en Storage (acopio-fotos)
  camara_id uuid references public.camaras(id),
  camara_inicio timestamptz,
  camara_fin timestamptz,
  despacho_id uuid references public.despachos(id),
  despachado_en timestamptz,
  estado text not null default 'abierto'
    check (estado in ('abierto','cerrado','recibido','en_camara','enfriado','despachado','anulado')),
  lat numeric(10,7),
  lng numeric(10,7),
  updated_at timestamptz not null default now()
);
create unique index bins_codigo_activo on public.bins(empresa_id, codigo) where estado not in ('despachado','anulado');
create index bins_fecha_idx on public.bins(empresa_id, coalesce(abierto_en, recibido_en));
create index bins_despacho_idx on public.bins(despacho_id);

alter table public.entregas add column bin_id uuid;  -- sin FK: el bin puede subir después que la entrega
create index entregas_bin_idx on public.entregas(bin_id) where bin_id is not null;

-- ---------- Eventos de bin (cola idempotente desde los teléfonos) ----------
create table public.eventos_bin (
  id uuid primary key,
  empresa_id uuid not null default public.mi_empresa() references public.empresas(id),
  codigo text not null,
  tipo text not null check (tipo in ('abrir','cerrar','armar','recibir','camara_entrada','camara_salida','despachar','anular')),
  bin_id uuid,                                 -- abrir/armar: id del bin generado en el teléfono
  datos jsonb not null default '{}'::jsonb,
  hecho_en timestamptz not null,
  hecho_por uuid not null default auth.uid() references public.perfiles(user_id),
  dispositivo text,
  resultado text,                              -- OK o código de rechazo
  mensaje text,
  bin_aplicado uuid,                           -- fila de bins afectada
  procesado_en timestamptz not null default now()
);
create index eventos_bin_codigo_idx on public.eventos_bin(empresa_id, codigo, hecho_en);
create index eventos_bin_rechazo_idx on public.eventos_bin(empresa_id, procesado_en) where resultado <> 'OK';

create or replace function public.tg_evento_bin() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_rol text;
  b public.bins%rowtype;
  d jsonb := coalesce(new.datos, '{}'::jsonb);
  v_desp public.despachos%rowtype;
  v_id uuid;
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

  -- ---------------- abrir (campo) ----------------
  if new.tipo = 'abrir' then
    if found then
      if b.id = new.bin_id then
        new.resultado := 'OK'; new.mensaje := 'Ya registrado'; new.bin_aplicado := b.id; return new;
      end if;
      -- El acopio lo recibió antes de que subiera la apertura desde el campo: se unen
      if b.origen = 'recepcion' and b.abierto_en is null and b.recibido_en >= new.hecho_en
         and not exists (select 1 from public.bins x where x.id = new.bin_id) then
        update public.bins set id = coalesce(new.bin_id, b.id), origen = 'campo',
          huerto_id = (d->>'huerto_id')::uuid, cuartel_id = (d->>'cuartel_id')::uuid,
          variedad_id = (d->>'variedad_id')::uuid, envase_id = (d->>'envase_id')::uuid,
          cuadrilla_id = (d->>'cuadrilla_id')::uuid,
          abierto_en = new.hecho_en, abierto_por = new.hecho_por,
          lat = (d->>'lat')::numeric, lng = (d->>'lng')::numeric, updated_at = now()
         where id = b.id;
        new.resultado := 'OK'; new.mensaje := 'Unido a la recepción ya registrada'; new.bin_aplicado := coalesce(new.bin_id, b.id); return new;
      end if;
      new.resultado := 'EA'; new.mensaje := 'El bin ya está en uso (' || b.estado || ')'; new.bin_aplicado := b.id; return new;
    end if;
    if new.bin_id is null then new.resultado := 'DI'; new.mensaje := 'Falta id del bin'; return new; end if;
    if exists (select 1 from public.bins x where x.id = new.bin_id) then
      new.resultado := 'OK'; new.mensaje := 'Ya registrado'; new.bin_aplicado := new.bin_id; return new;
    end if;
    insert into public.bins(id, empresa_id, codigo, origen, huerto_id, cuartel_id, variedad_id, envase_id, cuadrilla_id,
                            abierto_en, abierto_por, estado, lat, lng)
    values (new.bin_id, new.empresa_id, new.codigo, 'campo', (d->>'huerto_id')::uuid, (d->>'cuartel_id')::uuid,
            (d->>'variedad_id')::uuid, (d->>'envase_id')::uuid, (d->>'cuadrilla_id')::uuid,
            new.hecho_en, new.hecho_por, 'abierto', (d->>'lat')::numeric, (d->>'lng')::numeric);
    new.resultado := 'OK'; new.bin_aplicado := new.bin_id; return new;
  end if;

  -- ---------------- armar (acopio, bandejas sueltas) ----------------
  if new.tipo = 'armar' then
    if found then new.resultado := 'EA'; new.mensaje := 'El bin ya está en uso (' || b.estado || ')'; new.bin_aplicado := b.id; return new; end if;
    if exists (select 1 from public.bins x where x.id = new.bin_id) then
      new.resultado := 'OK'; new.mensaje := 'Ya registrado'; new.bin_aplicado := new.bin_id; return new;
    end if;
    if coalesce((d->>'envases')::numeric, 0) <= 0 then new.resultado := 'DI'; new.mensaje := 'Indica cuántos envases tiene el bin'; return new; end if;
    insert into public.bins(id, empresa_id, codigo, origen, huerto_id, cuartel_id, variedad_id, envase_id, cuadrilla_id,
                            envases_declarados, abierto_en, abierto_por, cerrado_en, recibido_en, recibido_por,
                            calidad, observacion, fotos, estado)
    values (coalesce(new.bin_id, gen_random_uuid()), new.empresa_id, new.codigo, 'acopio', (d->>'huerto_id')::uuid, (d->>'cuartel_id')::uuid,
            (d->>'variedad_id')::uuid, (d->>'envase_id')::uuid, (d->>'cuadrilla_id')::uuid,
            (d->>'envases')::numeric, new.hecho_en, new.hecho_por, new.hecho_en, new.hecho_en, new.hecho_por,
            coalesce(d->'calidad', '{}'::jsonb), nullif(d->>'observacion',''),
            coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(d->'fotos','[]'::jsonb)) x), '{}'),
            'recibido')
    returning id into v_id;
    new.resultado := 'OK'; new.bin_aplicado := v_id; return new;
  end if;

  -- ---------------- recibir ----------------
  if new.tipo = 'recibir' then
    if not found then
      -- Llegó al acopio sin registro de campo (o el teléfono del jefe aún no sincroniza)
      insert into public.bins(id, empresa_id, codigo, origen, recibido_en, recibido_por, calidad, observacion, fotos, estado)
      values (coalesce(new.bin_id, gen_random_uuid()), new.empresa_id, new.codigo, 'recepcion', new.hecho_en, new.hecho_por,
              coalesce(d->'calidad', '{}'::jsonb), nullif(d->>'observacion',''),
              coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(d->'fotos','[]'::jsonb)) x), '{}'),
              'recibido')
      returning id into v_id;
      new.resultado := 'OK'; new.mensaje := 'Recibido sin registro de campo'; new.bin_aplicado := v_id; return new;
    end if;
    if b.estado not in ('abierto','cerrado') then
      new.resultado := 'DR'; new.mensaje := 'El bin ya fue recibido (' || b.estado || ')'; new.bin_aplicado := b.id; return new;
    end if;
    update public.bins set cerrado_en = coalesce(cerrado_en, new.hecho_en), recibido_en = new.hecho_en, recibido_por = new.hecho_por,
      calidad = coalesce(d->'calidad', '{}'::jsonb), observacion = nullif(d->>'observacion',''),
      fotos = coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(d->'fotos','[]'::jsonb)) x), '{}'),
      estado = 'recibido', updated_at = now()
     where id = b.id;
    new.resultado := 'OK'; new.mensaje := case when b.estado = 'abierto' then 'Recibido (el bin seguía abierto en campo)' end;
    new.bin_aplicado := b.id; return new;
  end if;

  if not found then new.resultado := 'NF'; new.mensaje := 'No hay un bin activo con esa etiqueta'; return new; end if;
  new.bin_aplicado := b.id;

  -- ---------------- cerrar ----------------
  if new.tipo = 'cerrar' then
    if b.estado = 'abierto' then
      update public.bins set cerrado_en = new.hecho_en, estado = 'cerrado', updated_at = now() where id = b.id;
    elsif b.cerrado_en is null then
      update public.bins set cerrado_en = new.hecho_en, updated_at = now() where id = b.id;
    end if;
    new.resultado := 'OK'; return new;
  end if;

  -- ---------------- cámara ----------------
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

  -- ---------------- despachar ----------------
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

  -- ---------------- anular ----------------
  if new.tipo = 'anular' then
    update public.bins set estado = 'anulado', observacion = coalesce(observacion || ' | ', '') || 'Anulado: ' || coalesce(d->>'motivo',''), updated_at = now() where id = b.id;
    new.resultado := 'OK'; return new;
  end if;

  new.resultado := 'TI'; new.mensaje := 'Tipo de evento desconocido';
  return new;
end $$;
create trigger eventos_bin_procesar before insert on public.eventos_bin
  for each row execute function public.tg_evento_bin();
revoke execute on function public.tg_evento_bin() from public, anon, authenticated;

-- updated_at
create trigger camaras_upd before update on public.camaras for each row execute function public.tg_updated_at();
create trigger parametros_calidad_upd before update on public.parametros_calidad for each row execute function public.tg_updated_at();
create trigger despachos_upd before update on public.despachos for each row execute function public.tg_updated_at();

-- ---------- RLS ----------
do $$
declare t text;
begin
  foreach t in array array['camaras','parametros_calidad'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I_sel on public.%I for select to authenticated using (empresa_id = public.mi_empresa())', t, t);
    execute format('create policy %I_ins on public.%I for insert to authenticated with check (empresa_id = public.mi_empresa() and public.es_admin())', t, t);
    execute format('create policy %I_upd on public.%I for update to authenticated using (empresa_id = public.mi_empresa() and public.es_admin()) with check (empresa_id = public.mi_empresa() and public.es_admin())', t, t);
    execute format('create policy %I_del on public.%I for delete to authenticated using (empresa_id = public.mi_empresa() and public.es_admin())', t, t);
  end loop;
end $$;

alter table public.despachos enable row level security;
create policy despachos_sel on public.despachos for select to authenticated using (empresa_id = public.mi_empresa());
create policy despachos_ins on public.despachos for insert to authenticated
  with check (empresa_id = public.mi_empresa() and public.mi_rol() in ('admin','acopio'));
create policy despachos_upd on public.despachos for update to authenticated
  using (empresa_id = public.mi_empresa() and public.mi_rol() in ('admin','acopio'))
  with check (empresa_id = public.mi_empresa() and public.mi_rol() in ('admin','acopio'));

alter table public.bins enable row level security;
create policy bins_sel on public.bins for select to authenticated using (empresa_id = public.mi_empresa());
create policy bins_upd on public.bins for update to authenticated
  using (empresa_id = public.mi_empresa() and public.es_admin())
  with check (empresa_id = public.mi_empresa() and public.es_admin());

alter table public.eventos_bin enable row level security;
create policy eventos_bin_sel on public.eventos_bin for select to authenticated using (empresa_id = public.mi_empresa());
create policy eventos_bin_ins on public.eventos_bin for insert to authenticated
  with check (empresa_id = public.mi_empresa() and hecho_por = auth.uid() and public.mi_rol() in ('admin','jefe','acopio'));

-- ---------- Vista de bins con totales ----------
create or replace view public.v_bins with (security_invoker = true) as
select b.*,
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
            then round(extract(epoch from (b.recibido_en - b.cerrado_en)) / 60) end as minutos_a_acopio
  from public.bins b
  left join public.huertos h on h.id = b.huerto_id
  left join public.cuarteles c on c.id = b.cuartel_id
  left join public.variedades va on va.id = b.variedad_id
  left join public.especies es on es.id = va.especie_id
  left join public.envases en on en.id = b.envase_id
  left join public.cuadrillas cu on cu.id = b.cuadrilla_id
  left join public.perfiles pa on pa.user_id = b.abierto_por
  left join public.perfiles pr on pr.user_id = b.recibido_por
  left join public.camaras ca on ca.id = b.camara_id
  left join public.despachos de on de.id = b.despacho_id
  left join lateral (
    select sum(x.cantidad) as envases, sum(x.kilos_estimados) as kilos, count(distinct x.trabajador_id) as trabajadores
      from public.entregas x where x.bin_id = b.id and x.estado = 'A'
  ) e on true;

-- ---------- Fotos de recepción (Storage privado por empresa) ----------
insert into storage.buckets (id, name, public) values ('acopio-fotos', 'acopio-fotos', false)
  on conflict (id) do nothing;
create policy acopio_fotos_sel on storage.objects for select to authenticated
  using (bucket_id = 'acopio-fotos' and (storage.foldername(name))[1] = public.mi_empresa()::text);
create policy acopio_fotos_ins on storage.objects for insert to authenticated
  with check (bucket_id = 'acopio-fotos' and (storage.foldername(name))[1] = public.mi_empresa()::text
              and public.mi_rol() in ('admin','acopio'));
