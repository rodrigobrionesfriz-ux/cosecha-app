'use client';
import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth';

const MENU = [
  { href: '/admin/', t: 'Resumen' },
  { href: '/admin/reportes/', t: 'Reportes y pagos' },
  { href: '/admin/trabajadores/', t: 'Trabajadores' },
  { href: '/admin/tarjetas/', t: 'Tarjetas QR' },
  { href: '/admin/maestros/', t: 'Huertos y maestros' },
  { href: '/admin/config/', t: 'Reglas y tarifas' },
  { href: '/admin/usuarios/', t: 'Usuarios' },
  { href: '/campo/', t: '📱 App de terreno' },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const { session, perfil, cargando, salir } = useAuth();
  const [ruta, setRuta] = useState('');

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

  return (
    <div className="admin">
      <nav className="no-print">
        <div className="marca">🍒 Cosecha</div>
        <div className="empresa">{perfil.empresa?.nombre}</div>
        {MENU.map((m) => (
          <a key={m.href} href={m.href} className={activo(m.href) ? 'activo' : ''}>{m.t}</a>
        ))}
        <div className="pie">
          {perfil.nombre}<br />
          <span style={{ opacity: .7 }}>{perfil.rol}</span><br />
          <button className="chico" onClick={salir}>Cerrar sesión</button>
        </div>
      </nav>
      <main>{children}</main>
    </div>
  );
}
