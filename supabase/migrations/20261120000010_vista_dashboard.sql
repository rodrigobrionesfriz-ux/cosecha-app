-- Dashboard: la vista de entregas expone especie, variedad y cuadrilla (columnas nuevas al final).
create or replace view public.v_entregas_detalle with (security_invoker = true) as
select e.id, e.empresa_id, e.fecha, e.leido_en, e.estado, e.observacion,
       h.nombre as huerto, c.nombre as cuartel, va.nombre as variedad,
       en.nombre as envase, ca.nombre as calidad, tu.nombre as turno,
       co.nombre as contratista, cu.nombre as cuadrilla, p.nombre as jefe,
       t.rut, trim(t.nombres || ' ' || coalesce(t.apellido_paterno,'') || ' ' || coalesce(t.apellido_materno,'')) as trabajador,
       e.codigo_credencial, e.codigo_caja, e.cantidad, e.kilos_estimados,
       e.huerto_id, e.cuartel_id, e.envase_id, e.calidad_id, e.trabajador_id, e.contratista_id,
       round(coalesce(ta.valor, 0) * e.cantidad) as monto,
       e.editada, e.anulada_en, e.motivo_anulacion, pa.nombre as anulada_por_nombre, e.turno_id,
       coalesce(ta.valor, 0) as tarifa,
       case when e.contratista_id is not null then coalesce(ta.porcentaje_contratista, 0) else 0 end as porcentaje_contratista,
       case when e.contratista_id is not null then round(coalesce(ta.valor, 0) * e.cantidad * coalesce(ta.porcentaje_contratista, 0) / 100) else 0 end as monto_recargo,
       round(coalesce(ta.valor, 0) * e.cantidad)
         + case when e.contratista_id is not null then round(coalesce(ta.valor, 0) * e.cantidad * coalesce(ta.porcentaje_contratista, 0) / 100) else 0 end as monto_total,
       e.variedad_id, va.especie_id, es.nombre as especie, e.cuadrilla_id
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
  left join public.perfiles pa on pa.user_id = e.anulada_por
  join public.trabajadores t on t.id = e.trabajador_id
  left join lateral (
    select x.valor, x.porcentaje_contratista from public.tarifas x
     where x.empresa_id = e.empresa_id and x.envase_id = e.envase_id
       and (x.calidad_id is null or x.calidad_id = e.calidad_id)
       and x.vigente_desde <= e.fecha
     order by (x.calidad_id is not null) desc, x.vigente_desde desc limit 1
  ) ta on true;
