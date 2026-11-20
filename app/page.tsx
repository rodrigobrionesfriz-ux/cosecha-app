'use client';
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';

export default function Inicio() {
  const { session, perfil, cargando, salir } = useAuth();
  const [modo, setModo] = useState<'entrar' | 'registro'>('entrar');
  const [email, setEmail] = useState('');
  const [clave, setClave] = useState('');
  const [msg, setMsg] = useState<{ t: 'ok' | 'error' | 'info'; m: string } | null>(null);
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    if (cargando || !session || !perfil) return;
    const destino = new URLSearchParams(location.search).get('ir');
    // Los jefes de cuadrilla solo usan la app de terreno
    if (perfil.rol === 'jefe' || destino === 'campo') location.replace('/campo/');
    else location.replace('/admin/');
  }, [cargando, session, perfil]);

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setEnviando(true);
    setMsg(null);
    if (modo === 'entrar') {
      const { error } = await supabase.auth.signInWithPassword({ email, password: clave });
      if (error) setMsg({ t: 'error', m: error.message === 'Invalid login credentials' ? 'Correo o clave incorrectos' : error.message });
    } else {
      if (clave.length < 8 || !/[a-zA-Z]/.test(clave) || !/\d/.test(clave)) {
        setMsg({ t: 'error', m: 'La clave debe tener al menos 8 caracteres e incluir letras y números.' });
        setEnviando(false);
        return;
      }
      const { data, error } = await supabase.auth.signUp({ email, password: clave, options: { emailRedirectTo: location.origin } });
      if (error) setMsg({ t: 'error', m: /weak|password/i.test(error.message) ? 'La clave es muy débil: usa al menos 8 caracteres con letras y números.' : /registered|exists/i.test(error.message) ? 'Ese correo ya tiene cuenta. Usa "Entrar".' : error.message });
      else if (!data.session) setMsg({ t: 'info', m: 'Revisa tu correo para confirmar la cuenta y luego entra.' });
    }
    setEnviando(false);
  }

  if (cargando) return <div className="login muted">Cargando…</div>;

  if (session && !perfil) {
    return (
      <div className="login">
        <div className="logo">🍒</div>
        <h1>Cuenta sin acceso</h1>
        <div className="alerta aviso">
          Tu cuenta <b>{session.user.email}</b> existe, pero no está habilitada en ninguna empresa.
          Pide al administrador que te invite con este correo.
        </div>
        <button className="grande" onClick={salir}>Salir</button>
      </div>
    );
  }

  return (
    <div className="login">
      <div className="logo">🍒</div>
      <h1>Cosecha</h1>
      <form className="tarjeta" onSubmit={enviar}>
        <div className="campo">
          <label>Correo</label>
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
        </div>
        <div className="campo">
          <label>Clave{modo === 'registro' && ' (mínimo 8 caracteres, con letras y números)'}</label>
          <input type="password" required minLength={modo === 'registro' ? 8 : 6} value={clave} onChange={(e) => setClave(e.target.value)} autoComplete={modo === 'entrar' ? 'current-password' : 'new-password'} />
        </div>
        {msg && <div className={`alerta ${msg.t}`}>{msg.m}</div>}
        <button className="primario grande" disabled={enviando}>{modo === 'entrar' ? 'Entrar' : 'Crear cuenta'}</button>
        <p className="muted" style={{ textAlign: 'center', marginBottom: 0 }}>
          {modo === 'entrar' ? (
            <>¿Te invitaron y aún no tienes clave? <a href="#" onClick={(e) => { e.preventDefault(); setModo('registro'); setMsg(null); }}>Crear cuenta</a></>
          ) : (
            <>¿Ya tienes cuenta? <a href="#" onClick={(e) => { e.preventDefault(); setModo('entrar'); setMsg(null); }}>Entrar</a></>
          )}
        </p>
      </form>
    </div>
  );
}
