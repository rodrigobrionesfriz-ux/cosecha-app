-- Empresa configurable: datos legales, logo y datos de prevención (IRL / RIOHS) por empresa,
-- creación de nuevas empresas y cambio de empresa activa (solo superadministrador).

-- ---------- Datos de la empresa ----------
alter table public.empresas
  add column nombre_corto text,             -- para el menú y encabezados cortos
  add column giro text,
  add column direccion text,
  add column comuna text,
  add column ciudad text,
  add column telefono text,
  add column email text,
  add column representante text,
  add column logo_path text,                -- ruta en el bucket empresa-logos
  add column irl_razon_social text,         -- nombre que va en la planilla IRL (si difiere de la razón social)
  add column riohs_razon_social text,       -- nombre que va en el acuse del Reglamento Interno
  add column prev_nombre text,              -- encargado(a) de seguridad y salud en el trabajo
  add column prev_cargo text,
  add column prev_registro text,
  add column irl_codigo text,
  add column irl_version text,
  add column irl_aprobacion text,
  add column updated_at timestamptz not null default now();

-- Solo el administrador edita su empresa, y nunca el código ni el estado
revoke insert, update, delete, truncate on public.empresas from authenticated;
grant update (nombre, nombre_corto, rut, giro, direccion, comuna, ciudad, telefono, email, representante, logo_path,
              irl_razon_social, riohs_razon_social, prev_nombre, prev_cargo, prev_registro, irl_codigo, irl_version, irl_aprobacion, updated_at)
  on public.empresas to authenticated;
create policy empresas_upd on public.empresas for update to authenticated
  using (id = public.mi_empresa() and public.es_admin()) with check (id = public.mi_empresa() and public.es_admin());
create trigger empresas_updated before update on public.empresas for each row execute function public.tg_updated_at();

-- Datos actuales de La Cabaña (antes fijos en la planilla IRL)
update public.empresas set
  rut = coalesce(rut, '776847003'),
  nombre_corto = coalesce(nombre_corto, 'La Cabaña'),
  irl_razon_social = coalesce(irl_razon_social, 'AGRICOLA LA CABAÑA LIMITADA'),
  riohs_razon_social = coalesce(riohs_razon_social, 'SOCIEDAD AGRICOLA Y FORESTAL LA CABAÑA LIMITADA'),
  prev_nombre = coalesce(prev_nombre, 'MARICELA SCARLET ALARCON DIAZ'),
  prev_cargo = coalesce(prev_cargo, 'FIRMA ENCARGADO DE SEGURIDAD Y SALUD EN EL TRABAJO'),
  prev_registro = coalesce(prev_registro, 'BB-P 1.061'),
  irl_codigo = coalesce(irl_codigo, 'IRL: MTS'),
  irl_version = coalesce(irl_version, '1.0'),
  irl_aprobacion = coalesce(irl_aprobacion, 'ABRIL 2026')
where codigo = 1;

-- ---------- Superadministrador ----------
alter table public.perfiles add column superadmin boolean not null default false;
update public.perfiles set superadmin = true where lower(email) = 'rodrigo.briones.friz@gmail.com' and rol = 'admin';

create or replace function public.es_superadmin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select superadmin and rol = 'admin' from public.perfiles where user_id = auth.uid() and activo), false)
$$;
revoke execute on function public.es_superadmin() from public, anon;
grant execute on function public.es_superadmin() to authenticated;

-- El superadmin ve todas las empresas (para crearlas y cambiarse); el resto solo la suya
drop policy if exists empresas_sel on public.empresas;
create policy empresas_sel on public.empresas for select to authenticated using (id = public.mi_empresa() or public.es_superadmin());

-- El superadmin no puede cambiarse el flag a sí mismo ni a otros desde el cliente
create or replace function public.tg_perfil_superadmin() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.superadmin is distinct from old.superadmin and current_user = 'authenticated' then
    raise exception 'No se puede cambiar el superadministrador desde la app';
  end if;
  return new;
end $$;
create trigger perfiles_superadmin before update on public.perfiles for each row execute function public.tg_perfil_superadmin();
revoke execute on function public.tg_perfil_superadmin() from public, anon, authenticated;

-- ---------- Crear empresa ----------
create or replace function public.crear_empresa(p_nombre text, p_rut text, p_admin_email text, p_admin_nombre text, p_copiar_catalogos boolean default true)
returns table (id uuid, codigo smallint)
language plpgsql security definer set search_path = public as $$
declare
  v_origen uuid := public.mi_empresa();
  v_id uuid; v_cod smallint;
begin
  if not public.es_superadmin() then raise exception 'Solo el superadministrador puede crear empresas'; end if;
  if coalesce(trim(p_nombre), '') = '' then raise exception 'Indica la razón social'; end if;
  select coalesce(max(e.codigo), 0) + 1 into v_cod from public.empresas e;
  if v_cod > 99 then raise exception 'Se alcanzó el máximo de 99 empresas'; end if;

  insert into public.empresas (codigo, nombre, rut) values (v_cod, trim(p_nombre), nullif(regexp_replace(coalesce(p_rut, ''), '[^0-9kK]', '', 'g'), ''))
  returning empresas.id into v_id;

  if p_copiar_catalogos and v_origen is not null then
    insert into public.especies (empresa_id, nombre, activo) select v_id, nombre, activo from public.especies where empresa_id = v_origen;
    insert into public.variedades (empresa_id, especie_id, nombre, activo)
      select v_id, ne.id, v.nombre, v.activo from public.variedades v
        join public.especies oe on oe.id = v.especie_id
        join public.especies ne on ne.empresa_id = v_id and ne.nombre = oe.nombre
       where v.empresa_id = v_origen;
    insert into public.calidades (empresa_id, nombre, alias, orden, activo) select v_id, nombre, alias, orden, activo from public.calidades where empresa_id = v_origen;
    insert into public.turnos (empresa_id, nombre, orden, activo) select v_id, nombre, orden, activo from public.turnos where empresa_id = v_origen;
    insert into public.envases (empresa_id, nombre, alias, kilos_referencia, activo) select v_id, nombre, alias, kilos_referencia, activo from public.envases where empresa_id = v_origen;
  end if;

  if coalesce(trim(p_admin_email), '') <> '' then
    insert into public.invitaciones (email, empresa_id, nombre, rol)
    values (lower(trim(p_admin_email)), v_id, coalesce(nullif(trim(p_admin_nombre), ''), 'Administrador'), 'admin')
    on conflict (email) do update set empresa_id = excluded.empresa_id, nombre = excluded.nombre, rol = 'admin', usada_en = null;
  end if;
  return query select v_id, v_cod;
end $$;

-- ---------- Cambiar de empresa (superadmin) ----------
create or replace function public.cambiar_empresa(p_empresa uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.es_superadmin() then raise exception 'Solo el superadministrador puede cambiar de empresa'; end if;
  if not exists (select 1 from public.empresas where id = p_empresa and activa) then raise exception 'Empresa no encontrada o inactiva'; end if;
  update public.perfiles set empresa_id = p_empresa where user_id = auth.uid();
end $$;

revoke execute on function public.crear_empresa(text, text, text, text, boolean) from public, anon;
revoke execute on function public.cambiar_empresa(uuid) from public, anon;
grant execute on function public.crear_empresa(text, text, text, text, boolean) to authenticated;
grant execute on function public.cambiar_empresa(uuid) to authenticated;

-- ---------- Logos (bucket público: solo imágenes de marca) ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('empresa-logos', 'empresa-logos', true, 2097152, array['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'])
on conflict (id) do nothing;
create policy empresa_logos_sel on storage.objects for select to authenticated
  using (bucket_id = 'empresa-logos');
create policy empresa_logos_ins on storage.objects for insert to authenticated
  with check (bucket_id = 'empresa-logos' and (storage.foldername(name))[1] = public.mi_empresa()::text and public.es_admin());
create policy empresa_logos_upd on storage.objects for update to authenticated
  using (bucket_id = 'empresa-logos' and (storage.foldername(name))[1] = public.mi_empresa()::text and public.es_admin());
create policy empresa_logos_del on storage.objects for delete to authenticated
  using (bucket_id = 'empresa-logos' and (storage.foldername(name))[1] = public.mi_empresa()::text and public.es_admin());
