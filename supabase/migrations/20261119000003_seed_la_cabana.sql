-- Datos iniciales: La Cabaña (empresa 01)
-- El primer usuario que se registre con el correo indicado en bootstrap_admin queda como admin.
insert into public.empresas (codigo, nombre, rut)
values (1, 'Sociedad Agrícola y Forestal La Cabaña Ltda.', null)
on conflict (codigo) do nothing;

with emp as (select id from public.empresas where codigo = 1)
insert into public.especies (empresa_id, nombre) select id, 'Cerezo' from emp
on conflict do nothing;

with emp as (select id from public.empresas where codigo = 1)
insert into public.calidades (empresa_id, nombre, alias, orden)
select id, x.n, x.a, x.o from emp, (values ('Exportación','EXP',1),('Comercial','COM',2)) x(n,a,o)
on conflict do nothing;

with emp as (select id from public.empresas where codigo = 1)
insert into public.turnos (empresa_id, nombre, orden) select id, 'Jornada', 1 from emp
on conflict do nothing;

-- Alta del primer administrador: al crearse un usuario en auth con perfil pendiente, se vincula.
create table public.invitaciones (
  email text primary key,
  empresa_id uuid not null references public.empresas(id),
  nombre text not null,
  rol text not null default 'jefe' check (rol in ('admin','jefe','consulta')),
  usada_en timestamptz,
  created_at timestamptz not null default now()
);
alter table public.invitaciones enable row level security;
create policy invit_sel on public.invitaciones for select to authenticated using (empresa_id = public.mi_empresa() and public.es_admin());
create policy invit_ins on public.invitaciones for insert to authenticated with check (empresa_id = public.mi_empresa() and public.es_admin());
create policy invit_upd on public.invitaciones for update to authenticated using (empresa_id = public.mi_empresa() and public.es_admin()) with check (empresa_id = public.mi_empresa() and public.es_admin());

-- Cuando alguien se registra, si su correo está invitado se crea su perfil.
create or replace function public.tg_nuevo_usuario() returns trigger
language plpgsql security definer set search_path = public as $$
declare inv public.invitaciones%rowtype;
begin
  select * into inv from public.invitaciones where lower(email) = lower(new.email) and usada_en is null;
  if found then
    insert into public.perfiles(user_id, empresa_id, nombre, email, rol)
    values (new.id, inv.empresa_id, inv.nombre, new.email, inv.rol)
    on conflict (user_id) do nothing;
    update public.invitaciones set usada_en = now() where email = inv.email;
  end if;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.tg_nuevo_usuario();
revoke execute on function public.tg_nuevo_usuario() from public, anon, authenticated;
