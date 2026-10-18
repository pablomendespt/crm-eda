import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

export type AppRole = "socio" | "closer" | "sdr" | "cs";

/** Emails com acesso total (ver dados de toda a equipa). */
export const ADMIN_EMAILS = [
  "pabloguilhermegui14@gmail.com",
  "europadigitalacademy@gmail.com",
];

export function useAuthUser() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setUser(data.session?.user ?? null);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });
    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  return { user, loading };
}

export function useProfile() {
  const { user, loading: authLoading } = useAuthUser();
  const q = useQuery({
    queryKey: ["profile", user?.id],
    enabled: !!user,
    queryFn: async () => {
      if (!user) return null;
      const { data: profile } = await supabase
        .from("profiles")
        .select("*, member:members(*)")
        .eq("id", user.id)
        .maybeSingle();
      const { data: roles } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id);
      const rawRoles = (roles ?? []).map((r) => String(r.role));
      const roleList = rawRoles as AppRole[];
      const email = String(user.email ?? "").toLowerCase();
      // Sócio com papel de gerência (ou um dos emails históricos) vê toda a equipa.
      const isFullAdmin =
        roleList.includes("socio") && (rawRoles.includes("gerencia") || ADMIN_EMAILS.includes(email));
      // priority: socio > closer > cs > sdr
      const role: AppRole = isFullAdmin
        ? "socio"
        : roleList.includes("closer")
          ? "closer"
          : roleList.includes("cs")
            ? "cs"
            : "sdr";
      return { profile, role, roles: roleList, canViewAll: isFullAdmin, isGerencia: rawRoles.includes("gerencia"), email };
    },
  });
  return { ...q, user, authLoading };
}
