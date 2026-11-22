-- Marca en trabajadores si tiene ficha de ingreso (personal ingresado por administrativo o administración).
-- Los teléfonos de campo no pueden leer fichas_ingreso; con esta marca el jefe sabe, offline,
-- si el carnet escaneado está en la base de personal.
alter table public.trabajadores add column con_ficha boolean not null default false;

update public.trabajadores t set con_ficha = true
where exists (select 1 from public.fichas_ingreso f where f.trabajador_id = t.id);

create or replace function public.tg_ficha_marca() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    update trabajadores set con_ficha = true where id = new.trabajador_id and not con_ficha;
  elsif tg_op = 'DELETE' then
    update trabajadores set con_ficha = false where id = old.trabajador_id;
  end if;
  return null;
end $$;

create trigger fichas_ingreso_marca after insert or delete on public.fichas_ingreso
for each row execute function public.tg_ficha_marca();
