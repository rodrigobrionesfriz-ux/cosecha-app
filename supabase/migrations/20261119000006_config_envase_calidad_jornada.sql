-- Envase y calidad los fija el administrador por huerto; la jornada (Mañana/Tarde) se calcula por hora.
alter table public.config_huerto
  add column envase_id uuid references public.envases(id),
  add column calidad_id uuid references public.calidades(id),
  add column hora_inicio_tarde time not null default '13:00';
comment on column public.config_huerto.envase_id is 'Envase fijo definido por el administrador; el jefe de cuadrilla no lo puede cambiar';
comment on column public.config_huerto.calidad_id is 'Calidad fija definida por el administrador';
comment on column public.config_huerto.hora_inicio_tarde is 'Desde esta hora (Chile) la jornada es Tarde; antes, Mañana';
