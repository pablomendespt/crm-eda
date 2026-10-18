import { Link, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { LogOut } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useProfile } from "@/hooks/useAuth";
import { useEquipaFotos } from "@/hooks/useEquipaFotos";
import { Avatar } from "@/components/Avatar";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Button } from "@/components/ui/button";

export function NavigationFooter({ onNavigate }: { onNavigate?: () => void }) {
  const { data } = useProfile();
  const { mapa } = useEquipaFotos();
  const profile = data?.profile;
  const member = profile?.member_id ? mapa.get(profile.member_id) : undefined;
  const navigate = useNavigate();
  const qc = useQueryClient();
  async function signOut() {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    onNavigate?.();
    navigate({ to: "/auth", replace: true });
  }
  return (
    <footer className="shrink-0 border-t border-border p-3">
      <Link to="/perfil" onClick={onNavigate} className="flex min-h-11 items-center gap-3 rounded-lg px-2 text-text2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <Avatar nome={profile?.nome ?? "Utilizador"} foto={member?.foto_url} size={32} />
        <div className="min-w-0"><div className="text-xs font-semibold">Meu perfil</div><div className="truncate text-[11px]">{profile?.nome ?? "Utilizador"}</div></div>
      </Link>
      <div className="mt-2 flex items-center justify-between gap-2">
        <ThemeToggle />
        <Button variant="ghost" size="icon" className="min-h-11 min-w-11 text-text2" onClick={signOut} title="Sair" aria-label="Sair"><LogOut /></Button>
      </div>
    </footer>
  );
}
