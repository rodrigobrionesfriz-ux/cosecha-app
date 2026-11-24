-- La función de trigger no debe poder llamarse por la API
revoke all on function public.tg_ficha_marca() from public, anon, authenticated;
