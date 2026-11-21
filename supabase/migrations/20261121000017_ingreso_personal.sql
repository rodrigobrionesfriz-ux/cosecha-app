-- Ingreso de personal: rol "administrativo" y ficha de ingreso por trabajador
-- (datos del QR del carnet, dirección, contacto de emergencia y contratista).
-- El administrativo no escribe directo en trabajadores: usa registrar_ingreso().

-- ---------- Rol administrativo ----------
alter table public.perfiles drop constraint if exists perfiles_rol_check;
alter table public.perfiles add constraint perfiles_rol_check check (rol in ('admin','jefe','consulta','acopio','administrativo'));
alter table public.invitaciones drop constraint if exists invitaciones_rol_check;
alter table public.invitaciones add constraint invitaciones_rol_check check (rol in ('admin','jefe','consulta','acopio','administrativo'));

-- ---------- Ficha de ingreso (1 por trabajador) ----------
create table public.fichas_ingreso (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  trabajador_id uuid not null unique references public.trabajadores(id) on delete cascade,
  fecha_ingreso date not null default (now() at time zone 'America/Santiago')::date,
  fecha_nacimiento date,
  cedula_serie text,              -- número de documento (serial) del carnet
  cedula_vencimiento date,
  qr_texto text,                  -- contenido completo leído del QR
  direccion text,
  comuna text,
  contacto_nombre text,
  contacto_parentesco text,
  contacto_celular text check (contacto_celular is null or contacto_celular ~ '^\+569[0-9]{8}$'),
  observacion text,
  registrado_por uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index fichas_ingreso_empresa on public.fichas_ingreso(empresa_id, fecha_ingreso);
create trigger fichas_ingreso_updated before update on public.fichas_ingreso for each row execute function public.tg_updated_at();

alter table public.fichas_ingreso enable row level security;
create policy fichas_sel on public.fichas_ingreso for select to authenticated
  using (empresa_id = public.mi_empresa() and public.mi_rol() in ('admin','administrativo','consulta'));
create policy fichas_del on public.fichas_ingreso for delete to authenticated
  using (empresa_id = public.mi_empresa() and public.es_admin());
grant select, delete on public.fichas_ingreso to authenticated;

-- ---------- Registrar / actualizar un ingreso ----------
create or replace function public.registrar_ingreso(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_emp uuid := public.mi_empresa();
  v_rol text := public.mi_rol();
  v_ext boolean := coalesce((p->>'extranjero')::boolean, false);
  v_rut text := upper(trim(coalesce(p->>'rut', '')));
  v_cel text := nullif(regexp_replace(coalesce(p->>'contacto_celular', ''), '\s', '', 'g'), '');
  v_contr uuid := nullif(p->>'contratista_id', '')::uuid;
  v_id uuid;
begin
  if v_emp is null or v_rol not in ('admin','administrativo') then
    raise exception 'Solo administración o administrativo pueden registrar ingresos';
  end if;
  if not v_ext then
    v_rut := regexp_replace(v_rut, '[^0-9K]', '', 'g');
    v_rut := left(v_rut, length(v_rut) - 1) || '-' || right(v_rut, 1);
    if not public.rut_valido(v_rut) then raise exception 'RUT inválido'; end if;
  end if;
  if coalesce(trim(p->>'nombres'), '') = '' then raise exception 'Falta el nombre'; end if;
  if v_cel is not null and v_cel !~ '^\+569[0-9]{8}$' then raise exception 'Celular de contacto inválido (+569 y 8 dígitos)'; end if;
  if v_contr is not null and not exists (select 1 from contratistas where id = v_contr and empresa_id = v_emp) then
    raise exception 'Contratista no válido';
  end if;

  insert into trabajadores(empresa_id, rut, extranjero, nombres, apellido_paterno, apellido_materno, contratista_id)
  values (v_emp, v_rut, v_ext, trim(p->>'nombres'), nullif(trim(p->>'apellido_paterno'), ''), nullif(trim(p->>'apellido_materno'), ''), v_contr)
  on conflict (empresa_id, rut) do update set
    nombres = excluded.nombres, apellido_paterno = excluded.apellido_paterno, apellido_materno = excluded.apellido_materno,
    contratista_id = excluded.contratista_id,
    estado = case when trabajadores.estado = 'I' then 'A' else trabajadores.estado end
  returning id into v_id;

  insert into fichas_ingreso(empresa_id, trabajador_id, fecha_ingreso, fecha_nacimiento, cedula_serie, cedula_vencimiento, qr_texto,
    direccion, comuna, contacto_nombre, contacto_parentesco, contacto_celular, observacion, registrado_por)
  values (v_emp, v_id,
    coalesce(nullif(p->>'fecha_ingreso', '')::date, (now() at time zone 'America/Santiago')::date),
    nullif(p->>'fecha_nacimiento', '')::date, nullif(trim(p->>'cedula_serie'), ''), nullif(p->>'cedula_vencimiento', '')::date,
    nullif(p->>'qr_texto', ''), nullif(trim(p->>'direccion'), ''), nullif(trim(p->>'comuna'), ''),
    nullif(trim(p->>'contacto_nombre'), ''), nullif(trim(p->>'contacto_parentesco'), ''), v_cel,
    nullif(trim(p->>'observacion'), ''), auth.uid())
  on conflict (trabajador_id) do update set
    fecha_ingreso = excluded.fecha_ingreso, fecha_nacimiento = coalesce(excluded.fecha_nacimiento, fichas_ingreso.fecha_nacimiento),
    cedula_serie = coalesce(excluded.cedula_serie, fichas_ingreso.cedula_serie),
    cedula_vencimiento = coalesce(excluded.cedula_vencimiento, fichas_ingreso.cedula_vencimiento),
    qr_texto = coalesce(excluded.qr_texto, fichas_ingreso.qr_texto),
    direccion = excluded.direccion, comuna = excluded.comuna,
    contacto_nombre = excluded.contacto_nombre, contacto_parentesco = excluded.contacto_parentesco,
    contacto_celular = excluded.contacto_celular, observacion = excluded.observacion, registrado_por = auth.uid();
  return v_id;
end $$;
revoke all on function public.registrar_ingreso(jsonb) from public, anon;
grant execute on function public.registrar_ingreso(jsonb) to authenticated;

-- ---------- Vista para listado y reportes ----------
create or replace view public.v_fichas_ingreso with (security_invoker = true) as
select f.id, f.empresa_id, f.trabajador_id, t.rut, t.extranjero, t.nombres, t.apellido_paterno, t.apellido_materno,
       trim(concat_ws(' ', t.nombres, t.apellido_paterno, t.apellido_materno)) as nombre_completo,
       t.contratista_id, coalesce(c.nombre, 'Propio') as contratista, c.rut as contratista_rut, t.estado,
       f.fecha_ingreso, f.fecha_nacimiento, f.cedula_serie, f.cedula_vencimiento, f.qr_texto,
       f.direccion, f.comuna, f.contacto_nombre, f.contacto_parentesco, f.contacto_celular, f.observacion,
       p.nombre as registrado_por_nombre, f.created_at, f.updated_at
from public.fichas_ingreso f
join public.trabajadores t on t.id = f.trabajador_id
left join public.contratistas c on c.id = t.contratista_id
left join public.perfiles p on p.user_id = f.registrado_por;
grant select on public.v_fichas_ingreso to authenticated;
