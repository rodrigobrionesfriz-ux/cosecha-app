import './globals.css';
import type { Metadata, Viewport } from 'next';
import { AuthProvider } from '@/lib/auth';
import RegistrarSW from '@/components/RegistrarSW';

export const metadata: Metadata = {
  title: 'QSecha · Cosecha con QR',
  applicationName: 'QSecha',
  description: 'Registro de cosecha en terreno y administración',
  manifest: '/manifest.webmanifest',
  icons: { icon: [{ url: '/favicon-64.png', sizes: '64x64' }, { url: '/icon-192.png', sizes: '192x192' }], apple: '/apple-touch-icon.png' },
  appleWebApp: { capable: true, title: 'QSecha', statusBarStyle: 'default' },
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
