import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";

export type MembroDir = {
  id: string;
  nome: string;
  role: string;
  ativo: boolean;
  is_founder: boolean;
  is_socio: boolean;
};

/**
 * Diretório de membros com listas já filtradas por função.
 * - closers: membros com função Closer
 * - sdrs: membros com função SDR
 * - sócios (Pablo/Leandro) aparecem nas duas listas
 * Atualiza-se automaticamente quando se adiciona/remove/arquiva um membro.
 */
export function useMembrosDir() {
  const q = useQuery({
    queryKey: ["members-directory"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("list_members_directory");
      if (error) throw error;
      return (data ?? []) as MembroDir[];
    },
  });

  const ativos = useMemo(() => (q.data ?? []).filter((m) => m.ativo), [q.data]);
  const closers = useMemo(
    () => ativos.filter((m) => m.role === "closer" || m.role === "cs" || m.is_socio),
    [ativos],
  );
  const sdrs = useMemo(
    () => ativos.filter((m) => m.role === "sdr" || m.role === "cs" || m.is_socio),
    [ativos],
  );

  return { ...q, todos: q.data ?? [], ativos, closers, sdrs };
}
