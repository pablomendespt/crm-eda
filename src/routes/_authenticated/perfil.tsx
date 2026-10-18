import { createFileRoute } from "@tanstack/react-router";
import { useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Camera, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Avatar } from "@/components/Avatar";
import { Button } from "@/components/ui/button";
import { useProfile } from "@/hooks/useAuth";
import { useEquipaFotos } from "@/hooks/useEquipaFotos";
import { prepareProfilePhoto } from "@/lib/profile-photo";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/perfil")({
  component: MeuPerfil,
});

function MeuPerfil() {
  const inputRef = useRef<HTMLInputElement>(null);
  const qc = useQueryClient();
  const { data, user } = useProfile();
  const { mapa } = useEquipaFotos();
  const memberId = data?.profile?.member_id ?? null;
  const equipa = memberId ? mapa.get(memberId) : undefined;
  const nome = equipa?.nome ?? data?.profile?.nome ?? "Utilizador";
  const funcao = equipa?.funcao || equipa?.role || data?.role || "Equipa EDA";

  const foto = useMutation({
    mutationFn: async (pFoto: string | null) => {
      if (!memberId) throw new Error("Este perfil não está associado a um membro.");
      const { error } = await (supabase.rpc as any)("crm2_set_foto", { p_member: memberId, p_foto: pFoto });
      if (error) throw error;
    },
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["crm2-equipa"] }),
        qc.invalidateQueries({ queryKey: ["profile"] }),
      ]);
      toast.success("Fotografia atualizada.");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  async function onFile(file?: File) {
    if (!file) return;
    if (!file.type.startsWith("image/")) { toast.error("Escolha um ficheiro de imagem."); return; }
    try { foto.mutate(await prepareProfilePhoto(file)); }
    catch (error) { toast.error(error instanceof Error ? error.message : "Não foi possível preparar a imagem."); }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <p className="eda-eyebrow">Conta pessoal</p>
        <h1 className="text-2xl font-bold">Meu perfil</h1>
      </div>
      <section className="eda-card profile-panel">
        <Avatar nome={nome} foto={equipa?.foto_url} size={112} />
        <div className="min-w-0 flex-1 text-center sm:text-left">
          <h2 className="text-2xl font-bold">{nome}</h2>
          <p className="mt-1 capitalize text-sm text-text2">{funcao}</p>
          <p className="mt-3 break-all text-sm text-text3">{user?.email}</p>
          <div className="mt-6 flex flex-wrap justify-center gap-2 sm:justify-start">
            <Button type="button" onClick={() => inputRef.current?.click()} disabled={!memberId || foto.isPending}>
              <Camera /> {foto.isPending ? "A guardar..." : "Mudar foto"}
            </Button>
            <Button type="button" variant="outline" onClick={() => foto.mutate(null)} disabled={!memberId || foto.isPending || !equipa?.foto_url}>
              <Trash2 /> Remover foto
            </Button>
          </div>
          <input ref={inputRef} className="sr-only" type="file" accept="image/*" onChange={(event) => { void onFile(event.target.files?.[0]); event.currentTarget.value = ""; }} />
        </div>
      </section>
    </div>
  );
}
