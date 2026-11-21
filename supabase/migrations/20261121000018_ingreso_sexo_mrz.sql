-- Lectura del reverso del carnet (zona de lectura mecánica): sexo, nacionalidad y texto leído
alter table public.fichas_ingreso
  add column sexo char(1) check (sexo in ('M','F')),
  add column nacionalidad text,
  add column mrz_texto text;

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

  insert into fichas_ingreso(empresa_id, trabajador_id, fecha_ingreso, fecha_nacimiento, sexo, nacionalidad, mrz_texto, cedula_serie, cedula_vencimiento, qr_texto,
    direccion, comuna, contacto_nombre, contacto_parentesco, contacto_celular, observacion, registrado_por)
  values (v_emp, v_id,
    coalesce(nullif(p->>'fecha_ingreso', '')::date, (now() at time zone 'America/Santiago')::date),
    nullif(p->>'fecha_nacimiento', '')::date, nullif(p->>'sexo', ''), nullif(upper(trim(p->>'nacionalidad')), ''), nullif(p->>'mrz_texto', ''),
    nullif(trim(p->>'cedula_serie'), ''), nullif(p->>'cedula_vencimiento', '')::date,
    nullif(p->>'qr_texto', ''), nullif(trim(p->>'direccion'), ''), nullif(trim(p->>'comuna'), ''),
    nullif(trim(p->>'contacto_nombre'), ''), nullif(trim(p->>'contacto_parentesco'), ''), v_cel,
    nullif(trim(p->>'observacion'), ''), auth.uid())
  on conflict (trabajador_id) do update set
    fecha_ingreso = excluded.fecha_ingreso, fecha_nacimiento = coalesce(excluded.fecha_nacimiento, fichas_ingreso.fecha_nacimiento),
    sexo = coalesce(excluded.sexo, fichas_ingreso.sexo), nacionalidad = coalesce(excluded.nacionalidad, fichas_ingreso.nacionalidad),
    mrz_texto = coalesce(excluded.mrz_texto, fichas_ingreso.mrz_texto),
    cedula_serie = coalesce(excluded.cedula_serie, fichas_ingreso.cedula_serie),
    cedula_vencimiento = coalesce(excluded.cedula_vencimiento, fichas_ingreso.cedula_vencimiento),
    qr_texto = coalesce(excluded.qr_texto, fichas_ingreso.qr_texto),
    direccion = excluded.direccion, comuna = excluded.comuna,
    contacto_nombre = excluded.contacto_nombre, contacto_parentesco = excluded.contacto_parentesco,
    contacto_celular = excluded.contacto_celular, observacion = excluded.observacion, registrado_por = auth.uid();
  return v_id;
end $$;

drop view if exists public.v_fichas_ingreso;
create or replace view public.v_fichas_ingreso with (security_invoker = true) as
select f.id, f.empresa_id, f.trabajador_id, t.rut, t.extranjero, t.nombres, t.apellido_paterno, t.apellido_materno,
       trim(concat_ws(' ', t.nombres, t.apellido_paterno, t.apellido_materno)) as nombre_completo,
       t.contratista_id, coalesce(c.nombre, 'Propio') as contratista, c.rut as contratista_rut, t.estado,
       f.fecha_ingreso, f.fecha_nacimiento, f.sexo, f.nacionalidad, f.mrz_texto, f.cedula_serie, f.cedula_vencimiento, f.qr_texto,
       f.direccion, f.comuna, f.contacto_nombre, f.contacto_parentesco, f.contacto_celular, f.observacion,
       p.nombre as registrado_por_nombre, f.created_at, f.updated_at
from public.fichas_ingreso f
join public.trabajadores t on t.id = f.trabajador_id
left join public.contratistas c on c.id = t.contratista_id
left join public.perfiles p on p.user_id = f.registrado_por;
grant select on public.v_fichas_ingreso to authenticated;
