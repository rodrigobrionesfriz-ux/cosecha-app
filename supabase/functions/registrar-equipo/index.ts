// Registra un teléfono por su IMEI. Crea (o reinicia) el usuario del equipo y lo deja
// "pendiente" hasta que un administrador lo apruebe en el panel (Equipos).
// No requiere sesión: el teléfono aún no tiene usuario. La seguridad está en la aprobación.
import { createClient } from 'npm:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

/** IMEI: 15 dígitos con dígito verificador Luhn */
function imeiValido(imei: string) {
  if (!/^\d{15}$/.test(imei)) return false;
  let suma = 0;
  for (let i = 0; i < 15; i++) {
    let d = Number(imei[i]);
    if (i % 2 === 1) { d *= 2; if (d > 9) d -= 9; }
    suma += d;
  }
  return suma % 10 === 0;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405);
  try {
    const b = await req.json();
    const imei = String(b.imei ?? '').replace(/\D/g, '');
    const nombre = String(b.nombre ?? '').trim().slice(0, 60);
    const tipo = b.tipo === 'acopio' ? 'acopio' : 'campo';
    const codEmpresa = Number(String(b.empresa ?? '1').replace(/\D/g, '') || '1');
    const secreto = String(b.secreto ?? '');
    const modelo = String(b.modelo ?? '').slice(0, 120) || null;

    if (!imeiValido(imei)) return json({ error: 'IMEI inválido. Debe tener 15 dígitos (marca *#06# en el teléfono para verlo).' }, 400);
    if (nombre.length < 2) return json({ error: 'Indica un nombre para el equipo.' }, 400);
    if (secreto.length < 24) return json({ error: 'Solicitud inválida.' }, 400);

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });

    const { data: emp } = await admin.from('empresas').select('id,codigo,nombre').eq('codigo', codEmpresa).maybeSingle();
    if (!emp) return json({ error: 'Código de empresa no encontrado.' }, 400);

    const email = `equipo-${String(emp.codigo).padStart(2, '0')}-${imei}@equipos.qsecha.app`;
    const { data: existente } = await admin.from('equipos').select('id,user_id,estado').eq('empresa_id', emp.id).eq('imei', imei).maybeSingle();

    let userId = existente?.user_id as string | null | undefined;
    if (userId) {
      // Reinstalación u otro teléfono con el mismo IMEI: nueva clave y vuelve a pendiente
      const { error } = await admin.auth.admin.updateUserById(userId, { password: secreto });
      if (error) userId = null;
    }
    if (!userId) {
      const { data: u, error } = await admin.auth.admin.createUser({ email, password: secreto, email_confirm: true, user_metadata: { equipo: true } });
      if (error) {
        // el usuario quedó de un registro anterior sin fila de equipo
        const { data: l } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
        const previo = l?.users.find((x) => x.email === email);
        if (!previo) return json({ error: 'No se pudo registrar el equipo.' }, 500);
        await admin.auth.admin.updateUserById(previo.id, { password: secreto });
        userId = previo.id;
      } else userId = u.user.id;
    }

    if (existente) {
      await admin.from('equipos').update({ user_id: userId, nombre, tipo, modelo, estado: existente.estado === 'bloqueado' ? 'bloqueado' : 'pendiente', solicitado_en: new Date().toISOString() }).eq('id', existente.id);
      await admin.from('perfiles').update({ activo: false }).eq('user_id', userId);
    } else {
      const { error } = await admin.from('equipos').insert({ empresa_id: emp.id, imei, nombre, tipo, modelo, user_id: userId });
      if (error) return json({ error: error.message }, 500);
    }
    return json({ ok: true, email, empresa: emp.nombre, estado: existente?.estado === 'bloqueado' ? 'bloqueado' : 'pendiente' });
  } catch (e) {
    return json({ error: (e as Error).message || 'Error' }, 500);
  }
});
