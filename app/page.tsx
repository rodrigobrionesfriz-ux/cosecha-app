'use client';
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { entrarComoEquipo, equipoLocal, estadoEquipo, imeiValido, olvidarEquipo, registrarEquipo } from '@/lib/equipo';

export default function Inicio() {
  const { session, perfil, cargando, salir } = useAuth();
  const [modo, setModo] = useState<'entrar' | 'registro'>('entrar');
  const [vista, setVista] = useState<'inicio' | 'equipo' | 'admin'>('inicio');
  const [eq, setEq] = useState({ imei: '', nombre: '', tipo: 'campo' as 'campo' | 'acopio', empresa: '01' });
  const [estadoEq, setEstadoEq] = useState<{ estado: string; nombre: string; tipo: string } | null>(null);
  const [tieneEquipo, setTieneEquipo] = useState(false);
  const [intentoEquipo, setIntentoEquipo] = useState(false);

  // Teléfono registrado como equipo: entra solo con sus credenciales guardadas
  useEffect(() => {
    if (cargando) return;
    const local = equipoLocal();
    setTieneEquipo(!!local);
    if (local && !session && !intentoEquipo) { setIntentoEquipo(true); entrarComoEquipo(); }
    if (local && session && !perfil) estadoEquipo().then(setEstadoEq);
  }, [cargando, session, perfil, intentoEquipo]);

  async function registrar(e: React.FormEvent) {
    e.preventDefault();
    const imei = eq.imei.replace(/\D/g, '');
    if (!imeiValido(imei)) { setMsg({ t: 'error', m: 'IMEI inválido: son 15 dígitos. Marca *#06# en el teléfono para verlo.' }); return; }
    if (eq.nombre.trim().length < 2) { setMsg({ t: 'error', m: 'Ponle un nombre al equipo (ej. Cuadrilla 3).' }); return; }
    setEnviando(true); setMsg(null);
    try {
      await registrarEquipo({ ...eq, imei, nombre: eq.nombre.trim() });
      setTieneEquipo(true);
      setEstadoEq({ estado: 'pendiente', nombre: eq.nombre.trim(), tipo: eq.tipo });
    } catch (err: any) { setMsg({ t: 'error', m: err.message }); }
    setEnviando(false);
  }
  const [email, setEmail] = useState('');
  const [clave, setClave] = useState('');
  const [msg, setMsg] = useState<{ t: 'ok' | 'error' | 'info'; m: string } | null>(null);
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    if (cargando || !session || !perfil) return;
    const destino = new URLSearchParams(location.search).get('ir');
    // Los jefes de cuadrilla solo usan la app de terreno
    if (perfil.rol === 'acopio' || destino === 'acopio') location.replace('/acopio/');
    else if (perfil.rol === 'jefe' || destino === 'campo') location.replace('/campo/');
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

  if (session && !perfil && tieneEquipo) {
    const local = equipoLocal();
    const bloqueado = estadoEq?.estado === 'bloqueado';
    return (
      <div className="login">
        <img className="logo-img" src="/logo.svg" alt="QSecha" />
        <h1>{bloqueado ? 'Equipo bloqueado' : 'Esperando aprobación'}</h1>
        <div className={`alerta ${bloqueado ? 'error' : 'aviso'}`}>
          {bloqueado
            ? 'Administración bloqueó este equipo. Pide que lo habiliten de nuevo en el panel (Equipos).'
            : <>Este teléfono quedó registrado como <b>{estadoEq?.nombre ?? local?.nombre}</b> ({(estadoEq?.tipo ?? local?.tipo) === 'acopio' ? 'acopio' : 'campo'}). Pide al administrador que lo apruebe en el panel, en <b>Equipos</b>.</>}
        </div>
        <div className="tarjeta muted" style={{ fontSize: '.9rem' }}>IMEI: <span className="mono">{local?.imei}</span></div>
        <button className="primario grande" onClick={() => location.reload()}>Revisar de nuevo</button>
        <button className="grande" style={{ marginTop: '.5rem' }} onClick={async () => {
          if (!confirm('¿Borrar el registro de este teléfono para registrarlo de nuevo?')) return;
          olvidarEquipo(); await salir();
        }}>Registrar de nuevo</button>
      </div>
    );
  }

  if (session && !perfil) {
    return (
      <div className="login">
        <img className="logo-img" src="/logo.svg" alt="QSecha" />
        <h1>Cuenta sin acceso</h1>
        <div className="alerta aviso">
          Tu cuenta <b>{session.user.email}</b> existe, pero no está habilitada en ninguna empresa.
          Pide al administrador que te invite con este correo.
        </div>
        <button className="grande" onClick={salir}>Salir</button>
      </div>
    );
  }

  if (tieneEquipo && !session) {
    return (
      <div className="login">
        <img className="logo-img" src="/logo.svg" alt="QSecha" />
        <h1>Conectando el equipo…</h1>
        <div className="alerta aviso">{navigator.onLine ? 'Iniciando sesión del equipo.' : 'Sin señal. La primera vez el equipo necesita conexión para entrar.'}</div>
        <button className="primario grande" onClick={() => location.reload()}>Reintentar</button>
      </div>
    );
  }

  if (vista === 'inicio') {
    return (
      <div className="login">
        <img className="logo-img" src="/logo.svg" alt="QSecha" />
        <h1 style={{ marginBottom: '.2rem' }}>QSecha</h1>
        <p className="muted" style={{ textAlign: 'center', marginTop: 0 }}>Cosecha con QR</p>
        <button className="primario grande" onClick={() => { setVista('equipo'); setMsg(null); }}>📱 Registrar este teléfono como equipo</button>
        <p className="muted" style={{ textAlign: 'center', fontSize: '.88rem' }}>Para teléfonos de jefes de cuadrilla y de acopio.</p>
        <button className="grande" onClick={() => { setVista('admin'); setMsg(null); }}>Entrar con correo (administración)</button>
      </div>
    );
  }

  if (vista === 'equipo') {
    return (
      <div className="login">
        <img className="logo-img" src="/logo.svg" alt="QSecha" />
        <h1 style={{ marginBottom: '.2rem' }}>Registrar equipo</h1>
        <form className="tarjeta" onSubmit={registrar}>
          <div className="campo">
            <label>IMEI del teléfono</label>
            <input inputMode="numeric" maxLength={17} value={eq.imei} onChange={(e) => setEq({ ...eq, imei: e.target.value })} className="mono" placeholder="15 dígitos" />
            <div className="muted" style={{ fontSize: '.85rem' }}>Para verlo, marca <b>*#06#</b> en el teclado del teléfono. Si tiene dos, usa el IMEI 1.</div>
          </div>
          <div className="campo">
            <label>Nombre del equipo</label>
            <input value={eq.nombre} onChange={(e) => setEq({ ...eq, nombre: e.target.value })} placeholder="Ej. Cuadrilla 3" />
          </div>
          <div className="campo">
            <label>Uso</label>
            <div className="segmentado">
              <button type="button" className={eq.tipo === 'campo' ? 'activo' : ''} onClick={() => setEq({ ...eq, tipo: 'campo' })}>Campo (jefes)</button>
              <button type="button" className={eq.tipo === 'acopio' ? 'activo' : ''} onClick={() => setEq({ ...eq, tipo: 'acopio' })}>Acopio</button>
            </div>
          </div>
          <div className="campo">
            <label>Código de empresa</label>
            <input inputMode="numeric" value={eq.empresa} onChange={(e) => setEq({ ...eq, empresa: e.target.value })} style={{ maxWidth: 100 }} />
          </div>
          {msg && <div className={`alerta ${msg.t}`}>{msg.m}</div>}
          <button className="primario grande" disabled={enviando}>{enviando ? 'Registrando…' : 'Registrar equipo'}</button>
          <p className="muted" style={{ textAlign: 'center', marginBottom: 0 }}><a href="#" onClick={(e) => { e.preventDefault(); setVista('inicio'); }}>Volver</a></p>
        </form>
      </div>
    );
  }

  return (
    <div className="login">
      <img className="logo-img" src="/logo.svg" alt="QSecha" />
      <h1 style={{ marginBottom: '.2rem' }}>QSecha</h1>
      <p className="muted" style={{ textAlign: 'center', marginTop: 0 }}>Administración</p>
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
        <p className="muted" style={{ textAlign: 'center', marginBottom: 0 }}><a href="#" onClick={(e) => { e.preventDefault(); setVista('inicio'); }}>Volver</a></p>
      </form>
    </div>
  );
}
