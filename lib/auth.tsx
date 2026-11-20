'use client';
import { createContext, useContext, useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabase';

export type Perfil = {
  user_id: string;
  empresa_id: string;
  nombre: string;
  email: string;
  rol: 'admin' | 'jefe' | 'consulta' | 'acopio';
  activo: boolean;
  empresa?: { id: string; nombre: string; codigo: number };
};

type Ctx = {
  session: Session | null;
  perfil: Perfil | null;
  cargando: boolean;
  salir: () => Promise<void>;
};

const AuthCtx = createContext<Ctx>({ session: null, perfil: null, cargando: true, salir: async () => {} });
const PERFIL_KEY = 'cosecha-perfil';

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [perfil, setPerfil] = useState<Perfil | null>(null);
  const [cargando, setCargando] = useState(true);

  async function cargarPerfil(s: Session | null) {
    if (!s) { setPerfil(null); localStorage.removeItem(PERFIL_KEY); return; }
    // Sin señal: usar el perfil guardado
    const guardado = localStorage.getItem(PERFIL_KEY);
    if (!navigator.onLine && guardado) { setPerfil(JSON.parse(guardado)); return; }
    const { data, error } = await supabase
      .from('perfiles')
      .select('*, empresa:empresas(id,nombre,codigo)')
      .eq('user_id', s.user.id)
      .maybeSingle();
    if (error && guardado) { setPerfil(JSON.parse(guardado)); return; }
    if (data) localStorage.setItem(PERFIL_KEY, JSON.stringify(data));
    setPerfil((data as Perfil) || null);
  }

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      setSession(data.session);
      await cargarPerfil(data.session);
      setCargando(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange(async (_e, s) => {
      setSession(s);
      await cargarPerfil(s);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  async function salir() {
    await supabase.auth.signOut();
    localStorage.removeItem(PERFIL_KEY);
    setPerfil(null);
    location.href = '/';
  }

  return <AuthCtx.Provider value={{ session, perfil, cargando, salir }}>{children}</AuthCtx.Provider>;
}

export const useAuth = () => useContext(AuthCtx);
