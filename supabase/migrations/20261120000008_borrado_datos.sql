-- Borrado lógico de entregas por lote (papelera) con motivo, validaciones y recuperación.
create table public.borrados (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id),
  tipo text not null check (tipo in ('pruebas','error_carga','otro')),
  motivo text not null check (length(trim(motivo)) >= 10),
  filtros jsonb not null,
  cantidad int not null,
  envases numeric not null default 0,
  creado_por uuid not null default auth.uid(),
  creado_por_nombre text,
  creado_en timestamptz not null default now(),
  recuperado_en timestamptz,
  recuperado_por_nombre text,
  motivo_recuperacion text
);
alter table public.borrados enable row level security;
create policy borrados_sel on public.borrados for select to authenticated
  using (empresa_id = public.mi_empresa() and public.es_admin());

alter table public.entregas drop constraint entregas_estado_check;
alter table public.entregas add constraint entregas_estado_check check (estado in ('A','X','D','B'));
alter table public.entregas
  add column borrado_id uuid references public.borrados(id),
  add column estado_previo char(1);
create index entregas_borrado_idx on public.entregas(borrado_id) where borrado_id is not null;

create or replace function public.previsualizar_borrado(p_desde date, p_hasta date, p_huerto uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_emp uuid := public.mi_empresa(); r jsonb;
begin
  if not public.es_admin() then raise exception 'Solo administradores'; end if;
  select jsonb_build_object('cantidad', count(*), 'envases', coalesce(sum(cantidad),0),
    'trabajadores', count(distinct trabajador_id), 'dias', count(distinct fecha),
    'jefes', count(distinct jefe_user_id), 'desde', min(fecha), 'hasta', max(fecha))
  into r from public.entregas
  where empresa_id = v_emp and estado <> 'B' and fecha between p_desde and p_hasta
    and (p_huerto is null or huerto_id = p_huerto);
  return r;
end $$;

create or replace function public.borrar_entregas(
  p_desde date, p_hasta date, p_huerto uuid, p_tipo text, p_motivo text,
  p_confirmacion text, p_cantidad_esperada int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_emp uuid := public.mi_empresa(); v_id uuid; v_n int; v_env numeric;
begin
  if not public.es_admin() then raise exception 'Solo administradores pueden borrar datos'; end if;
  if p_confirmacion is distinct from 'BORRAR' then raise exception 'Confirmación incorrecta: debes escribir BORRAR'; end if;
  if length(trim(coalesce(p_motivo,''))) < 10 then raise exception 'El motivo debe tener al menos 10 caracteres'; end if;
  if p_desde is null or p_hasta is null or p_hasta < p_desde then raise exception 'Rango de fechas inválido'; end if;
  select count(*), coalesce(sum(cantidad),0) into v_n, v_env from public.entregas
   where empresa_id = v_emp and estado <> 'B' and fecha between p_desde and p_hasta
     and (p_huerto is null or huerto_id = p_huerto);
  if v_n = 0 then raise exception 'No hay registros para borrar con esos filtros'; end if;
  if v_n <> p_cantidad_esperada then
    raise exception 'La cantidad cambió (vista previa: %, ahora: %). Revisa de nuevo antes de borrar.', p_cantidad_esperada, v_n;
  end if;
  insert into public.borrados(empresa_id, tipo, motivo, filtros, cantidad, envases, creado_por_nombre)
  values (v_emp, p_tipo, trim(p_motivo),
          jsonb_build_object('desde', p_desde, 'hasta', p_hasta, 'huerto_id', p_huerto,
                             'huerto', (select nombre from public.huertos where id = p_huerto)),
          v_n, v_env, (select nombre from public.perfiles where user_id = auth.uid()))
  returning id into v_id;
  update public.entregas set estado_previo = estado, estado = 'B', borrado_id = v_id
   where empresa_id = v_emp and estado <> 'B' and fecha between p_desde and p_hasta
     and (p_huerto is null or huerto_id = p_huerto);
  return jsonb_build_object('id', v_id, 'cantidad', v_n);
end $$;

create or replace function public.recuperar_borrado(p_id uuid, p_motivo text)
returns int language plpgsql security definer set search_path = public as $$
declare v_emp uuid := public.mi_empresa(); v_b public.borrados%rowtype; v_n int;
begin
  if not public.es_admin() then raise exception 'Solo administradores'; end if;
  if length(trim(coalesce(p_motivo,''))) < 3 then raise exception 'Indica el motivo de la recuperación'; end if;
  select * into v_b from public.borrados where id = p_id and empresa_id = v_emp for update;
  if not found then raise exception 'Borrado no encontrado'; end if;
  if v_b.recuperado_en is not null then raise exception 'Este borrado ya fue recuperado'; end if;
  update public.entregas set estado = coalesce(estado_previo, 'A'), estado_previo = null, borrado_id = null
   where borrado_id = p_id and empresa_id = v_emp;
  get diagnostics v_n = row_count;
  update public.borrados set recuperado_en = now(), motivo_recuperacion = trim(p_motivo),
         recuperado_por_nombre = (select nombre from public.perfiles where user_id = auth.uid())
   where id = p_id;
  return v_n;
end $$;

revoke execute on function public.previsualizar_borrado(date,date,uuid) from public, anon;
revoke execute on function public.borrar_entregas(date,date,uuid,text,text,text,int) from public, anon;
revoke execute on function public.recuperar_borrado(uuid,text) from public, anon;
grant execute on function public.previsualizar_borrado(date,date,uuid) to authenticated;
grant execute on function public.borrar_entregas(date,date,uuid,text,text,text,int) to authenticated;
grant execute on function public.recuperar_borrado(uuid,text) to authenticated;

-- Mientras esté en la papelera, ninguna otra función puede modificar el registro
create or replace function public.tg_entrega_no_borrada() returns trigger
language plpgsql set search_path = public as $$
begin
  if old.estado = 'B' and new.borrado_id is not null and to_jsonb(new) is distinct from to_jsonb(old) then
    raise exception 'El registro está en la papelera; recupéralo desde Borrado de datos antes de modificarlo';
  end if;
  return new;
end $$;
create trigger entregas_no_borrada before update on public.entregas for each row execute function public.tg_entrega_no_borrada();
revoke execute on function public.tg_entrega_no_borrada() from public, anon, authenticated;
