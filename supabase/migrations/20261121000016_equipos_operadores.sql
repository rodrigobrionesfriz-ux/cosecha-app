-- =====================================================================
-- Equipos (teléfonos registrados por IMEI y aprobados en el panel) y
-- operadores sin correo (jefes de cuadrilla y operadores de acopio) con PIN.
--
-- Cada equipo es un usuario de Supabase Auth creado por la función
-- "registrar-equipo"; su perfil queda inactivo hasta que el administrador
-- lo aprueba. El perfil toma rol 'jefe' (campo) o 'acopio', así que los
-- permisos existentes siguen funcionando. Quién hizo cada registro queda
-- en operador_id.
-- =====================================================================

create table public.equipos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id),
  imei text not null,
  nombre text not null,
  tipo text not null default 'campo' check (tipo in ('campo','acopio')),
  estado text not null default 'pendiente' check (estado in ('pendiente','aprobado','bloqueado')),
  user_id uuid unique references auth.users(id) on delete set null,
  solicitado_en timestamptz not null default now(),
  aprobado_en timestamptz,
  aprobado_por uuid references public.perfiles(user_id),
  ultima_conexion timestamptz,
  modelo text,
  unique (empresa_id, imei)
);
alter table public.equipos enable row level security;
create policy equipos_sel on public.equipos for select to authenticated
  using ((empresa_id = public.mi_empresa() and public.es_admin()) or user_id = auth.uid());

create table public.operadores (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id),
  nombre text not null,
  rut text,
  rol text not null default 'jefe' check (rol in ('jefe','acopio')),
  pin_sal text,
  pin_hash text,            -- sha256(sal || ':' || pin) en hex; el teléfono lo verifica sin señal
  activo boolean not null default true,
  cuadrilla_id uuid references public.cuadrillas(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (empresa_id, nombre)
);
create trigger operadores_upd before update on public.operadores for each row execute function public.tg_updated_at();
alter table public.operadores enable row level security;
create policy operadores_sel on public.operadores for select to authenticated using (empresa_id = public.mi_empresa());
create policy operadores_ins on public.operadores for insert to authenticated with check (empresa_id = public.mi_empresa() and public.es_admin());
create policy operadores_upd on public.operadores for update to authenticated using (empresa_id = public.mi_empresa() and public.es_admin()) with check (empresa_id = public.mi_empresa() and public.es_admin());
create policy operadores_del on public.operadores for delete to authenticated using (empresa_id = public.mi_empresa() and public.es_admin());

-- PIN: lo fija el administrador; se guarda solo el hash
create or replace function public.fijar_pin_operador(p_id uuid, p_pin text) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare v_sal text := encode(extensions.gen_random_bytes(8), 'hex');
begin
  if not public.es_admin() then raise exception 'Solo administradores'; end if;
  if p_pin !~ '^[0-9]{4}$' then raise exception 'El PIN debe tener 4 dígitos'; end if;
  update public.operadores set pin_sal = v_sal, pin_hash = encode(extensions.digest(v_sal || ':' || p_pin, 'sha256'), 'hex')
   where id = p_id and empresa_id = public.mi_empresa();
  if not found then raise exception 'Operador no encontrado'; end if;
end $$;
revoke execute on function public.fijar_pin_operador(uuid,text) from public, anon;
grant execute on function public.fijar_pin_operador(uuid,text) to authenticated;

-- Aprobar / bloquear equipos
create or replace function public.aprobar_equipo(p_id uuid, p_tipo text, p_nombre text) returns void
language plpgsql security definer set search_path = public as $$
declare q public.equipos%rowtype;
begin
  if not public.es_admin() then raise exception 'Solo administradores'; end if;
  if p_tipo not in ('campo','acopio') then raise exception 'Tipo inválido'; end if;
  select * into q from public.equipos where id = p_id and empresa_id = public.mi_empresa() for update;
  if not found then raise exception 'Equipo no encontrado'; end if;
  if q.user_id is null then raise exception 'El equipo debe registrarse de nuevo desde el teléfono'; end if;
  update public.equipos set estado = 'aprobado', tipo = p_tipo, nombre = coalesce(nullif(trim(p_nombre),''), nombre),
    aprobado_en = now(), aprobado_por = auth.uid() where id = p_id;
  insert into public.perfiles(user_id, empresa_id, nombre, email, rol, activo)
  values (q.user_id, q.empresa_id, 'Equipo ' || coalesce(nullif(trim(p_nombre),''), q.nombre), null,
          case p_tipo when 'acopio' then 'acopio' else 'jefe' end, true)
  on conflict (user_id) do update set nombre = excluded.nombre, rol = excluded.rol, activo = true;
end $$;
revoke execute on function public.aprobar_equipo(uuid,text,text) from public, anon;
grant execute on function public.aprobar_equipo(uuid,text,text) to authenticated;

create or replace function public.bloquear_equipo(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare q public.equipos%rowtype;
begin
  if not public.es_admin() then raise exception 'Solo administradores'; end if;
  select * into q from public.equipos where id = p_id and empresa_id = public.mi_empresa() for update;
  if not found then raise exception 'Equipo no encontrado'; end if;
  update public.equipos set estado = 'bloqueado' where id = p_id;
  update public.perfiles set activo = false where user_id = q.user_id;
end $$;
revoke execute on function public.bloquear_equipo(uuid) from public, anon;
grant execute on function public.bloquear_equipo(uuid) to authenticated;

-- El equipo informa que sigue en uso (para el panel)
create or replace function public.equipo_conectado() returns void
language sql security definer set search_path = public as $$
  update public.equipos set ultima_conexion = now() where user_id = auth.uid();
$$;
revoke execute on function public.equipo_conectado() from public, anon;
grant execute on function public.equipo_conectado() to authenticated;

-- ---------- Quién hizo cada registro ----------
alter table public.entregas add column operador_id uuid references public.operadores(id);
alter table public.bins
  add column abierto_operador_id uuid references public.operadores(id),
  add column recibido_operador_id uuid references public.operadores(id);

-- El operador viaja en los eventos (datos.operador_id)
create or replace function public.tg_evento_bin_operador() returns trigger
language plpgsql security definer set search_path = public as $$
declare v uuid := nullif(new.datos->>'operador_id','')::uuid;
begin
  if v is null or new.resultado <> 'OK' or new.bin_aplicado is null then return null; end if;
  if not exists (select 1 from public.operadores where id = v and empresa_id = new.empresa_id) then return null; end if;
  if new.tipo = 'abrir' then
    update public.bins set abierto_operador_id = v where id = new.bin_aplicado;
  elsif new.tipo in ('recibir','armar') then
    update public.bins set recibido_operador_id = v,
      abierto_operador_id = case when new.tipo = 'armar' then v else abierto_operador_id end
     where id = new.bin_aplicado;
  end if;
  return null;
end $$;
revoke execute on function public.tg_evento_bin_operador() from public, anon, authenticated;
create trigger eventos_bin_operador after insert on public.eventos_bin
  for each row execute function public.tg_evento_bin_operador();

-- ---------- Vistas: el nombre del operador reemplaza al del equipo ----------
do $$
declare v text;
begin
  v := pg_get_viewdef('public.v_entregas_detalle'::regclass, true);
  v := replace(v, 'p.nombre AS jefe', 'COALESCE(op.nombre, p.nombre) AS jefe');
  v := replace(v, 'LEFT JOIN perfiles p ON p.user_id = e.jefe_user_id', 'LEFT JOIN perfiles p ON p.user_id = e.jefe_user_id LEFT JOIN operadores op ON op.id = e.operador_id');
  v := regexp_replace(v, 'e\.cuadrilla_id\s+FROM entregas e', 'e.cuadrilla_id, e.operador_id FROM entregas e');
  if position('op.nombre' in v) = 0 or position('e.operador_id FROM' in v) = 0 then raise exception 'No se pudo ajustar v_entregas_detalle'; end if;
  execute 'create or replace view public.v_entregas_detalle with (security_invoker = true) as ' || rtrim(v, ';');

  v := pg_get_viewdef('public.v_bins'::regclass, true);
  v := replace(v, 'pa.nombre AS abierto_por_nombre', 'COALESCE(oa.nombre, pa.nombre) AS abierto_por_nombre');
  v := replace(v, 'pr.nombre AS recibido_por_nombre', 'COALESCE(orc.nombre, pr.nombre) AS recibido_por_nombre');
  v := replace(v, 'LEFT JOIN perfiles pr ON pr.user_id = b.recibido_por', 'LEFT JOIN perfiles pr ON pr.user_id = b.recibido_por LEFT JOIN operadores oa ON oa.id = b.abierto_operador_id LEFT JOIN operadores orc ON orc.id = b.recibido_operador_id');
  if position('oa.nombre' in v) = 0 or position('orc.nombre' in v) = 0 or position('JOIN operadores oa' in v) = 0 then raise exception 'No se pudo ajustar v_bins'; end if;
  execute 'create or replace view public.v_bins with (security_invoker = true) as ' || rtrim(v, ';');

  v := pg_get_viewdef('public.v_conciliaciones'::regclass, true);
  v := replace(v, 'pa.nombre AS jefe', 'COALESCE(oa.nombre, pa.nombre) AS jefe');
  v := replace(v, 'pr.nombre AS recibido_por_nombre', 'COALESCE(orc.nombre, pr.nombre) AS recibido_por_nombre');
  v := replace(v, 'LEFT JOIN perfiles pr ON pr.user_id = b.recibido_por', 'LEFT JOIN perfiles pr ON pr.user_id = b.recibido_por LEFT JOIN operadores oa ON oa.id = b.abierto_operador_id LEFT JOIN operadores orc ON orc.id = b.recibido_operador_id');
  if position('JOIN operadores oa' in v) = 0 then raise exception 'No se pudo ajustar v_conciliaciones'; end if;
  execute 'create or replace view public.v_conciliaciones with (security_invoker = true) as ' || rtrim(v, ';');
end $$;
