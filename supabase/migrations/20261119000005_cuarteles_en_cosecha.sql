-- Cuarteles habilitados para cosecha: solo estos aparecen en la app de terreno.
-- Los nuevos parten deshabilitados; los existentes al momento de la migración quedan habilitados.
alter table public.cuarteles add column en_cosecha boolean not null default false;
update public.cuarteles set en_cosecha = true;
comment on column public.cuarteles.en_cosecha is 'Si es true, el cuartel aparece en la app de terreno para registrar cosecha';
