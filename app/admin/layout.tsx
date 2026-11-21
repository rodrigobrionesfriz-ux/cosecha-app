'use client';
import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth';

const MENU = [
  { href: '/admin/', t: 'Dashboard', i: '📊' },
  { href: '/admin/reportes/', t: 'Reportes y pagos', i: '💵' },
  { href: '/admin/acopio/', t: 'Acopio y bins', i: '🧺' },
  { href: '/admin/anulados/', t: 'Anulados y cambios', i: '🗂️' },
  { href: '/admin/trabajadores/', t: 'Trabajadores', i: '👷' },
  { href: '/admin/ingresos/', t: 'Ingreso de personal', i: '📝' },
  { href: '/admin/tarjetas/', t: 'Tarjetas QR', i: '🪪' },
  { href: '/admin/maestros/', t: 'Huertos y maestros', i: '🌳' },
  { href: '/admin/config/', t: 'Reglas y tarifas', i: '⚙️' },
  { href: '/admin/usuarios/', t: 'Usuarios', i: '👤' },
  { href: '/admin/equipos/', t: 'Equipos', i: '📱' },
  { href: '/admin/borrado/', t: 'Borrado de datos', i: '🗑️' },
  { href: '/campo/', t: 'App de terreno', i: '📱' },
  { href: '/acopio/', t: 'App de acopio', i: '🏭' },
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
  if (perfil.rol === 'acopio') {
    if (typeof window !== 'undefined') location.replace('/acopio/');
    return <div style={{ padding: '2rem' }} className="muted">Abriendo la app de acopio…</div>;
  }
  if (perfil.rol === 'jefe') {
    // Sin acceso al panel: directo a la app de terreno
    if (typeof window !== 'undefined') location.replace('/campo/');
    return <div style={{ padding: '2rem' }} className="muted">Abriendo la app de terreno…</div>;
  }

  // Administrativo: solo ingreso de personal
  const menu = perfil.rol === 'administrativo' ? MENU.filter((m) => m.href.startsWith('/admin/ingresos/')) : MENU;
  if (perfil.rol === 'administrativo' && ruta && !ruta.startsWith('/admin/ingresos')) {
    if (typeof window !== 'undefined') location.replace('/admin/ingresos/');
    return <div style={{ padding: '2rem' }} className="muted">Abriendo ingreso de personal…</div>;
  }

  const activo = (h: string) => (h === '/admin/' ? ruta === '/admin/' || ruta === '/admin' : ruta.startsWith(h));
  const actual = menu.find((m) => activo(m.href));

  return (
    <div className="admin">
      {/* Barra superior solo en teléfono */}
      <header className="admin-movil no-print">
        <span className="marca"><img src="/logo.svg" alt="" className="marca-ico" />{actual?.t ?? 'QSecha'}</span>
        <button className="btn-menu" onClick={() => setAbierto(!abierto)} aria-label="Menú">{abierto ? '✕' : '☰'}</button>
      </header>

      <nav className={`no-print ${abierto ? 'abierto' : ''}`}>
        <div className="marca solo-escritorio"><img src="/logo.svg" alt="" className="marca-ico" />QSecha</div>
        <div className="empresa">{perfil.empresa?.nombre}</div>
        {menu.map((m) => (
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
