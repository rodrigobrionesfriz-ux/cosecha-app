-- Kilos reales recibidos en packing por día y huerto.
-- El Informe cosecha diaria reparte estos kilos entre los totes del día
-- (factor = kilos packing / kilos estimados). No cambia el pago, que es por envase.
create table public.kilos_packing (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null default public.mi_empresa() references public.empresas(id) on delete cascade,
  fecha date not null,
  huerto_id uuid not null references public.huertos(id) on delete cascade,
  kilos numeric(12,1) not null check (kilos >= 0),
  nota text,
  actualizado_por uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (empresa_id, fecha, huerto_id)
);
create trigger kilos_packing_updated before update on public.kilos_packing for each row execute function public.tg_updated_at();

alter table public.kilos_packing enable row level security;
create policy kilos_packing_sel on public.kilos_packing for select to authenticated using (empresa_id = public.mi_empresa());
create policy kilos_packing_ins on public.kilos_packing for insert to authenticated with check (empresa_id = public.mi_empresa() and public.es_admin());
create policy kilos_packing_upd on public.kilos_packing for update to authenticated using (empresa_id = public.mi_empresa() and public.es_admin()) with check (empresa_id = public.mi_empresa() and public.es_admin());
create policy kilos_packing_del on public.kilos_packing for delete to authenticated using (empresa_id = public.mi_empresa() and public.es_admin());
revoke all on public.kilos_packing from anon;
