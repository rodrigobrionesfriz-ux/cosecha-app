'use client';
import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth';

const MENU = [
  { href: '/admin/', t: 'Resumen', i: '📊' },
  { href: '/admin/reportes/', t: 'Reportes y pagos', i: '💵' },
  { href: '/admin/anulados/', t: 'Anulados y cambios', i: '🗂️' },
  { href: '/admin/trabajadores/', t: 'Trabajadores', i: '👷' },
  { href: '/admin/tarjetas/', t: 'Tarjetas QR', i: '🪪' },
  { href: '/admin/maestros/', t: 'Huertos y maestros', i: '🌳' },
  { href: '/admin/config/', t: 'Reglas y tarifas', i: '⚙️' },
  { href: '/admin/usuarios/', t: 'Usuarios', i: '👤' },
  { href: '/campo/', t: 'App de terreno', i: '📱' },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const { session, perfil, cargando, salir } = useAuth();
  const [ruta, setRuta] = useState('');
  const [abierto, setAbierto] = useState(false);

  useEffect(() => { setRuta(location.pathname); }, []);
  useEffect(() => {
    if (!cargando && (!session || !perfil)) location.replace('/');
  }, [cargando, session, perfil]);

  if (cargando || !perfil) return <div style={{ padding: '2rem' }} className="muted">Cargando…</div>;
  if (perfil.rol === 'jefe') {
    return (
      <div className="login">
        <div className="alerta aviso">Tu usuario es de terreno. El panel de administración es solo para administradores.</div>
        <a className="btn primario grande" href="/campo/">Ir a la app de terreno</a>
      </div>
    );
  }

  const activo = (h: string) => (h === '/admin/' ? ruta === '/admin/' || ruta === '/admin' : ruta.startsWith(h));
  const actual = MENU.find((m) => activo(m.href));

  return (
    <div className="admin">
      {/* Barra superior solo en teléfono */}
      <header className="admin-movil no-print">
        <span className="marca">🍒 {actual?.t ?? 'Cosecha'}</span>
        <button className="btn-menu" onClick={() => setAbierto(!abierto)} aria-label="Menú">{abierto ? '✕' : '☰'}</button>
      </header>

      <nav className={`no-print ${abierto ? 'abierto' : ''}`}>
        <div className="marca solo-escritorio">🍒 Cosecha</div>
        <div className="empresa">{perfil.empresa?.nombre}</div>
        {MENU.map((m) => (
          <a key={m.href} href={m.href} className={activo(m.href) ? 'activo' : ''}>
            <span className="ico">{m.i}</span>{m.t}
          </a>
        ))}
        <div className="pie">
          {perfil.nombre} <span style={{ opacity: .7 }}>· {perfil.rol}</span><br />
          <button className="chico" onClick={salir}>Cerrar sesión</button>
        </div>
      </nav>
      {abierto && <div className="velo no-print" onClick={() => setAbierto(false)} />}
      <main>{children}</main>
    </div>
  );
}
