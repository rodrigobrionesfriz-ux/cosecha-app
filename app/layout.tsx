import './globals.css';
import type { Metadata, Viewport } from 'next';
import { AuthProvider } from '@/lib/auth';
import RegistrarSW from '@/components/RegistrarSW';

export const metadata: Metadata = {
  title: 'Cosecha La Cabaña',
  description: 'Registro de cosecha en terreno y administración',
  manifest: '/manifest.webmanifest',
  icons: { icon: '/icon-192.png', apple: '/icon-192.png' },
};

export const viewport: Viewport = {
  themeColor: '#1f4a27',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>
        <AuthProvider>{children}</AuthProvider>
        <RegistrarSW />
      </body>
    </html>
  );
}
