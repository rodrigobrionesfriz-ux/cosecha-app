-- Tarifa separada según la forma de contratación:
--   valor             = pago al cosechero propio / interno por envase
--   valor_contratista = pago al cosechero que trabaja por contratista (null = mismo valor que propios)
-- El % de recargo del contratista se calcula sobre el pago a su cosechero.
alter table public.tarifas add column valor_contratista numeric(12,2) check (valor_contratista is null or valor_contratista >= 0);
comment on column public.tarifas.valor is 'Pago al cosechero propio / interno por envase ($)';
comment on column public.tarifas.valor_contratista is 'Pago al cosechero de contratista por envase ($); null = mismo valor que propios';
comment on column public.tarifas.porcentaje_contratista is 'Recargo % sobre el pago al cosechero de contratista, que se paga al contratista';

create or replace view public.v_entregas_detalle with (security_invoker = true) as
select e.id, e.empresa_id, e.fecha, e.leido_en, e.estado, e.observacion,
       h.nombre as huerto, c.nombre as cuartel, va.nombre as variedad,
       en.nombre as envase, ca.nombre as calidad, tu.nombre as turno,
       co.nombre as contratista, cu.nombre as cuadrilla, coalesce(op.nombre, p.nombre) as jefe,
       t.rut, trim(t.nombres || ' ' || coalesce(t.apellido_paterno,'') || ' ' || coalesce(t.apellido_materno,'')) as trabajador,
       e.codigo_credencial, e.codigo_caja, e.cantidad, e.kilos_estimados,
       e.huerto_id, e.cuartel_id, e.envase_id, e.calidad_id, e.trabajador_id, e.contratista_id,
       round(tv.valor * e.cantidad) as monto,
       e.editada, e.anulada_en, e.motivo_anulacion, pa.nombre as anulada_por_nombre, e.turno_id,
       tv.valor as tarifa,
       case when e.contratista_id is not null then coalesce(ta.porcentaje_contratista, 0) else 0 end as porcentaje_contratista,
       case when e.contratista_id is not null then round(tv.valor * e.cantidad * coalesce(ta.porcentaje_contratista, 0) / 100) else 0 end as monto_recargo,
       round(tv.valor * e.cantidad)
         + case when e.contratista_id is not null then round(tv.valor * e.cantidad * coalesce(ta.porcentaje_contratista, 0) / 100) else 0 end as monto_total,
       e.variedad_id, va.especie_id, es.nombre as especie, e.cuadrilla_id, e.operador_id
  from public.entregas e
  join public.huertos h on h.id = e.huerto_id
  join public.cuarteles c on c.id = e.cuartel_id
  left join public.variedades va on va.id = e.variedad_id
  left join public.especies es on es.id = va.especie_id
  join public.envases en on en.id = e.envase_id
  left join public.calidades ca on ca.id = e.calidad_id
  left join public.turnos tu on tu.id = e.turno_id
  left join public.contratistas co on co.id = e.contratista_id
  left join public.cuadrillas cu on cu.id = e.cuadrilla_id
  left join public.perfiles p on p.user_id = e.jefe_user_id
  left join public.operadores op on op.id = e.operador_id
  left join public.perfiles pa on pa.user_id = e.anulada_por
  join public.trabajadores t on t.id = e.trabajador_id
  left join lateral (
    select x.valor, x.valor_contratista, x.porcentaje_contratista from public.tarifas x
     where x.empresa_id = e.empresa_id and x.envase_id = e.envase_id
       and (x.calidad_id is null or x.calidad_id = e.calidad_id)
       and x.vigente_desde <= e.fecha
     order by (x.calidad_id is not null) desc, x.vigente_desde desc limit 1
  ) ta on true
  cross join lateral (
    select coalesce(case when e.contratista_id is not null then coalesce(ta.valor_contratista, ta.valor) else ta.valor end, 0) as valor
  ) tv;
