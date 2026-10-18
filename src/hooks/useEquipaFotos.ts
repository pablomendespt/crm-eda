import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type EquipaFoto = {
  id: string;
  nome: string;
  role: string;
  funcao: string | null;
  foto_url: string | null;
  is_socio: boolean;
};

export function useEquipaFotos() {
  const query = useQuery({
    queryKey: ["crm2-equipa"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("crm2_equipa");
      if (error) throw error;
      return (data ?? []) as EquipaFoto[];
    },
  });
  const mapa = useMemo(() => new Map((query.data ?? []).map((m) => [m.id, m])), [query.data]);
  const porNome = useMemo(() => new Map((query.data ?? []).map((m) => [m.nome, m])), [query.data]);
  return { ...query, mapa, porNome };
}
