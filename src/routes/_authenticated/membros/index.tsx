import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { Camera } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useProfile } from "@/hooks/useAuth";
import { Avatar } from "@/components/Avatar";
import { Button } from "@/components/ui/button";
import { useEquipaFotos } from "@/hooks/useEquipaFotos";
import { prepareProfilePhoto } from "@/lib/profile-photo";

export const Route = createFileRoute("/_authenticated/membros/")({
  component: MembrosList,
});

function MembrosList() {
  const { data: profile } = useProfile();
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [fotoMember, setFotoMember] = useState<string | null>(null);
  const { mapa } = useEquipaFotos();
  const { data } = useQuery({
    queryKey: ["members"],
    queryFn: async () => {
      const { data } = await supabase.from("members").select("*").eq("ativo", true).order("role").order("nome");
      return data ?? [];
    },
  });
  const setFoto = useMutation({
    mutationFn: async ({ memberId, foto }: { memberId: string; foto: string }) => {
      const { error } = await supabase.rpc("crm2_set_foto", { p_member: memberId, p_foto: foto });
      if (error) throw error;
    },
    onSuccess: async () => {
      await Promise.all([qc.invalidateQueries({ queryKey: ["crm2-equipa"] }), qc.invalidateQueries({ queryKey: ["profile"] })]);
      toast.success("Fotografia atualizada.");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  async function escolherFoto(file?: File) {
    if (!file || !fotoMember) return;
    try { setFoto.mutate({ memberId: fotoMember, foto: await prepareProfilePhoto(file) }); }
    catch (error) { toast.error(error instanceof Error ? error.message : "Não foi possível preparar a imagem."); }
  }

  if (profile && profile.role !== "socio") {
    return (
      <div className="eda-card">
        <h1 className="text-xl font-bold">Sem acesso</h1>
        <p className="text-sm mt-2" style={{ color: "var(--text2)" }}>Esta área é restrita a Sócios.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Membros da equipa</h1>
        <p className="text-sm mt-1" style={{ color: "var(--text2)" }}>Clique para ver a página individual.</p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {data?.map((m) => (
          <div
            key={m.id}
            className="eda-card relative hover:opacity-90 transition-opacity"
          >
            <Link to="/membros/$id" params={{ id: m.id }} className="flex items-center justify-between gap-4 pr-9">
              <div className="flex min-w-0 items-center gap-3">
                <Avatar nome={m.nome} foto={mapa.get(m.id)?.foto_url} size={48} />
                <div className="min-w-0">
                <div className="font-semibold">{m.nome}</div>
                <div className="text-xs uppercase mt-1" style={{ color: m.role === "closer" ? "var(--accent)" : "var(--gold)" }}>
                  {m.role}
                </div>
                </div>
               </div>
              <div className="text-right">
                <div className="text-lg font-bold">{Number(m.comissao_pct)}%</div>
                {m.is_founder && <div className="text-[10px]" style={{ color: "var(--gold)" }}>Fundador</div>}
              </div>
            </Link>
            <Button type="button" variant="ghost" size="icon" className="absolute right-3 top-3" title={`Mudar fotografia de ${m.nome}`} aria-label={`Mudar fotografia de ${m.nome}`} onClick={() => { setFotoMember(m.id); inputRef.current?.click(); }}>
              <Camera />
            </Button>
          </div>
        ))}
      </div>
      <input ref={inputRef} className="sr-only" type="file" accept="image/*" onChange={(event) => { void escolherFoto(event.target.files?.[0]); event.currentTarget.value = ""; }} />
    </div>
  );
}
