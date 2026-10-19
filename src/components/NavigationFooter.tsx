import { Link, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { LogOut, Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useProfile } from "@/hooks/useAuth";
import { useEquipaFotos } from "@/hooks/useEquipaFotos";
import { Avatar } from "@/components/Avatar";

const ROLE_LABEL: Record<string, string> = { socio: "Sócio", closer: "Closer", sdr: "SDR", cs: "Customer Success" };

export function NavigationFooter({ onNavigate }: { onNavigate?: () => void }) {
  const { data } = useProfile();
  const { mapa } = useEquipaFotos();
  const profile = data?.profile;
  const member = profile?.member_id ? mapa.get(profile.member_id) : undefined;
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  useEffect(() => { setTheme(document.documentElement.classList.contains("light") ? "light" : "dark"); }, []);
  function toggleTheme() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    try { localStorage.setItem("eda-theme", next); } catch { /* ignore */ }
    document.documentElement.classList.toggle("light", next === "light");
    document.documentElement.classList.toggle("dark", next === "dark");
  }
  async function signOut() {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    onNavigate?.();
    navigate({ to: "/auth", replace: true });
  }
  return (
    <footer className="shrink-0 border-t border-border p-3">
      <div className="flex items-center gap-2">
        <Link to="/perfil" onClick={onNavigate} className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg p-1.5 hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <Avatar nome={profile?.nome ?? "Utilizador"} foto={member?.foto_url} size={32} />
          <div className="min-w-0 leading-tight">
            <div className="truncate text-[13px] font-semibold text-foreground">{profile?.nome ?? "Utilizador"}</div>
            <div className="truncate text-[11px] text-text2">{ROLE_LABEL[data?.role ?? ""] ?? ""}</div>
          </div>
        </Link>
        <button type="button" onClick={toggleTheme} className="nav-icon-btn" title={theme === "dark" ? "Tema claro" : "Tema escuro"} aria-label={theme === "dark" ? "Mudar para tema claro" : "Mudar para tema escuro"}>
          {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
        </button>
        <button type="button" onClick={signOut} className="nav-icon-btn" title="Sair" aria-label="Sair"><LogOut size={16} /></button>
      </div>
    </footer>
  );
}
