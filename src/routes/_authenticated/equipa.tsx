import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { friendlyError } from "@/lib/rls-error";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Trash2, KeyRound } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useProfile, type AppRole } from "@/hooks/useAuth";
import { createTeamUser, deleteTeamUser, resetTeamUserPassword } from "@/lib/admin-users.functions";
import { Avatar } from "@/components/Avatar";
import { useEquipaFotos } from "@/hooks/useEquipaFotos";

export const Route = createFileRoute("/_authenticated/equipa")({
  component: Equipa,
});

// Funções de servidor indisponíveis nesta versão: mostra mensagem amigável.
function fnErrorMessage(e: unknown): string {
  const msg = e instanceof Error ? e.message : "";
  if (msg.includes("indisponível")) return msg;
  return friendlyError(e);
}

function Equipa() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: prof, isLoading } = useProfile();
  const { mapa } = useEquipaFotos();

  useEffect(() => {
    if (!isLoading && prof && prof.role !== "socio") {
      toast.error("Acesso restrito a sócios.");
      navigate({ to: "/funil", replace: true });
    }
  }, [isLoading, prof, navigate]);

  const { data: profiles } = useQuery({
    queryKey: ["profiles", "all"],
    queryFn: async () => {
      const { data } = await supabase
        .from("profiles")
        .select("*, member:members(nome, role)")
        .order("created_at", { ascending: false });
      return data ?? [];
    },
  });

  const { data: members } = useQuery({
    queryKey: ["members"],
    queryFn: async () => {
      const { data } = await supabase.from("members").select("*").order("nome");
      return data ?? [];
    },
  });

  const { data: roles } = useQuery({
    queryKey: ["user_roles", "all"],
    queryFn: async () => {
      const { data } = await supabase.from("user_roles").select("*");
      return data ?? [];
    },
  });

  const roleByUser = new Map<string, AppRole>();
  (roles ?? []).forEach((r) => {
    const current = roleByUser.get(r.user_id);
    const order = { socio: 4, closer: 3, cs: 2, sdr: 1 } as const;
    if (!current || order[r.role as AppRole] > order[current]) {
      roleByUser.set(r.user_id, r.role as AppRole);
    }
  });

  const setRole = useMutation({
    mutationFn: async ({ userId, role }: { userId: string; role: AppRole }) => {
      await supabase.from("user_roles").delete().eq("user_id", userId);
      const { error } = await supabase.from("user_roles").insert({ user_id: userId, role });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Função atualizada.");
      qc.invalidateQueries({ queryKey: ["user_roles"] });
    },
    onError: (e: Error) => toast.error(friendlyError(e)),
  });

  const updProfile = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: { ativo?: boolean; member_id?: string | null; nome?: string } }) => {
      const { error } = await supabase.from("profiles").update(patch).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Atualizado.");
      qc.invalidateQueries({ queryKey: ["profiles"] });
    },
  });

  // Add member
  const [mNome, setMNome] = useState("");
  const [mRole, setMRole] = useState<"closer" | "sdr" | "cs">("sdr");
  const [mPct, setMPct] = useState("3");
  const [mFounder, setMFounder] = useState(false);

  const removeMember = useMutation({
    mutationFn: async (id: string): Promise<"removido" | "arquivado"> => {
      const { data, error } = await supabase.from("members").delete().eq("id", id).select("id");
      if (error) {
        // Membro com histórico (vendas, registos diários...) não pode ser apagado:
        // arquiva-se (fica inativo) para preservar o histórico.
        const code = (error as { code?: string }).code;
        if (code === "23503") {
          const { data: upd, error: e2 } = await supabase
            .from("members")
            .update({ ativo: false })
            .eq("id", id)
            .select("id");
          if (e2) throw e2;
          if (!upd || upd.length === 0) throw new Error("Sem permissão para remover este membro.");
          await supabase.from("profiles").update({ member_id: null }).eq("member_id", id);
          return "arquivado";
        }
        throw error;
      }
      if (!data || data.length === 0) throw new Error("Sem permissão para remover este membro.");
      return "removido";
    },
    onSuccess: (res) => {
      toast.success(
        res === "arquivado"
          ? "Membro arquivado (tem histórico associado, por isso os registos foram preservados)."
          : "Membro removido.",
      );
      qc.invalidateQueries({ queryKey: ["members"] });
      qc.invalidateQueries({ queryKey: ["members-directory"] });
      qc.invalidateQueries({ queryKey: ["profiles"] });
    },
    onError: (e: Error) => toast.error(friendlyError(e)),
  });

  const reactivateMember = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("members").update({ ativo: true }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Membro reativado.");
      qc.invalidateQueries({ queryKey: ["members"] });
      qc.invalidateQueries({ queryKey: ["members-directory"] });
    },
    onError: (e: Error) => toast.error(friendlyError(e)),
  });

  const addMember = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("members").insert({
        nome: mNome,
        role: mRole,
        comissao_pct: Number(mPct),
        is_founder: mFounder,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Membro adicionado.");
      setMNome("");
      qc.invalidateQueries({ queryKey: ["members"] });
    },
  });

  // Create user account (admin)
  const createUserFn = createTeamUser;
  const deleteUserFn = deleteTeamUser;
  const resetPwdFn = resetTeamUserPassword;

  const [uEmail, setUEmail] = useState("");
  const [uSenha, setUSenha] = useState("");
  const [uNome, setUNome] = useState("");
  const [uRole, setURole] = useState<AppRole>("sdr");
  const [uMember, setUMember] = useState("");

  const createUser = useMutation({
    mutationFn: () =>
      createUserFn({
        data: {
          email: uEmail.trim().toLowerCase(),
          password: uSenha,
          nome: uNome.trim(),
          role: uRole,
          member_id: uMember || null,
        },
      }),
    onSuccess: () => {
      toast.success(`Conta criada para ${uNome}.`);
      setUEmail(""); setUSenha(""); setUNome(""); setURole("sdr"); setUMember("");
      qc.invalidateQueries({ queryKey: ["profiles"] });
      qc.invalidateQueries({ queryKey: ["user_roles"] });
    },
    onError: (e: Error) => toast.error(fnErrorMessage(e)),
  });

  const deleteUser = useMutation({
    mutationFn: (user_id: string) => deleteUserFn({ data: { user_id } }),
    onSuccess: () => {
      toast.success("Conta removida.");
      qc.invalidateQueries({ queryKey: ["profiles"] });
      qc.invalidateQueries({ queryKey: ["user_roles"] });
    },
    onError: (e: Error) => toast.error(fnErrorMessage(e)),
  });

  const resetPwd = useMutation({
    mutationFn: (v: { user_id: string; password: string }) => resetPwdFn({ data: v }),
    onSuccess: () => toast.success("Senha redefinida."),
    onError: (e: Error) => toast.error(fnErrorMessage(e)),
  });

  if (isLoading || prof?.role !== "socio") return null;


  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Gestão de Equipa</h1>
        <p className="text-sm mt-1" style={{ color: "var(--text2)" }}>Aprovar utilizadores, atribuir funções e gerir membros.</p>
      </div>

      <div className="eda-card">
        <h3 className="font-semibold mb-1">Criar conta de acesso</h3>
        <p className="text-xs mb-4" style={{ color: "var(--text3)" }}>
          Define o email e uma senha inicial para cada membro. O membro pode alterar a senha depois.
        </p>
        <form
          className="grid grid-cols-1 md:grid-cols-6 gap-3"
          onSubmit={(e) => { e.preventDefault(); createUser.mutate(); }}
        >
          <input className="eda-input md:col-span-1" placeholder="Nome" value={uNome} onChange={(e) => setUNome(e.target.value)} required />
          <input className="eda-input md:col-span-2" type="email" placeholder="email@exemplo.com" value={uEmail} onChange={(e) => setUEmail(e.target.value)} required />
          <input className="eda-input md:col-span-1" type="text" placeholder="Senha (mín. 8)" value={uSenha} onChange={(e) => setUSenha(e.target.value)} minLength={8} required />
          <select className="eda-input" value={uRole} onChange={(e) => setURole(e.target.value as AppRole)}>
            <option value="sdr">SDR</option>
            <option value="closer">Closer</option>
            <option value="cs">Customer Success</option>
            <option value="socio">Sócio</option>
          </select>
          <select className="eda-input" value={uMember} onChange={(e) => setUMember(e.target.value)}>
            <option value="">— Sem membro —</option>
            {members?.filter((m) => m.ativo).map((m) => (
              <option key={m.id} value={m.id}>{m.nome} ({m.role})</option>
            ))}
          </select>
          <button className="eda-btn md:col-span-6" type="submit" disabled={createUser.isPending}>
            {createUser.isPending ? "A criar..." : "Criar conta"}
          </button>
        </form>
      </div>

      <div className="eda-card">
        <h3 className="font-semibold mb-4">Utilizadores</h3>
        <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr style={{ color: "var(--text2)" }} className="text-left text-xs uppercase">
            <th className="py-2">Nome</th><th>Email</th><th>Função</th><th>Membro</th><th>Ativo</th><th>Ações</th>
          </tr></thead>
          <tbody>
            {profiles?.map((p: { id: string; nome: string; email: string; ativo: boolean; member_id: string | null }) => (
              <tr key={p.id} className="border-t" style={{ borderColor: "var(--border)" }}>
                 <td className="py-2.5 font-medium"><div className="flex items-center gap-2"><Avatar nome={p.nome} foto={p.member_id ? mapa.get(p.member_id)?.foto_url : null} size={32} /><span>{p.nome}</span></div></td>
                <td style={{ color: "var(--text2)" }}>{p.email}</td>
                <td>
                  <select
                    className="eda-input"
                    style={{ width: "auto", padding: "4px 8px" }}
                    value={roleByUser.get(p.id) ?? "sdr"}
                    onChange={(e) => setRole.mutate({ userId: p.id, role: e.target.value as AppRole })}
                  >
                    <option value="sdr">SDR</option>
                    <option value="closer">Closer</option>
                    <option value="cs">Customer Success</option>
                    <option value="socio">Sócio</option>
                  </select>
                </td>
                <td>
                  <select
                    className="eda-input"
                    style={{ width: "auto", padding: "4px 8px" }}
                    value={p.member_id ?? ""}
                    onChange={(e) => updProfile.mutate({ id: p.id, patch: { member_id: e.target.value || null } })}
                  >
                    <option value="">—</option>
                    {members?.filter((m) => m.ativo).map((m) => (
                      <option key={m.id} value={m.id}>{m.nome} ({m.role})</option>
                    ))}
                  </select>
                </td>
                <td>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={p.ativo} onChange={(e) => updProfile.mutate({ id: p.id, patch: { ativo: e.target.checked } })} />
                    <span className="text-xs" style={{ color: p.ativo ? "var(--green)" : "var(--text3)" }}>{p.ativo ? "Ativo" : "Inativo"}</span>
                  </label>
                </td>
                <td>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      title="Redefinir senha"
                      className="p-1.5 rounded"
                      style={{ border: "1px solid var(--border)", color: "var(--gold)" }}
                      onClick={() => {
                        const pwd = window.prompt(`Nova senha para ${p.email} (mín. 8):`);
                        if (pwd && pwd.length >= 8) resetPwd.mutate({ user_id: p.id, password: pwd });
                        else if (pwd) toast.error("Senha demasiado curta.");
                      }}
                    >
                      <KeyRound size={14} />
                    </button>
                    <button
                      type="button"
                      title="Apagar conta"
                      className="p-1.5 rounded"
                      style={{ border: "1px solid var(--border)", color: "var(--red)" }}
                      onClick={() => {
                        if (window.confirm(`Apagar definitivamente a conta ${p.email}?`)) {
                          deleteUser.mutate(p.id);
                        }
                      }}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>


      <div className="eda-card">
        <h3 className="font-semibold mb-4">Membros</h3>
        <form className="grid grid-cols-1 md:grid-cols-5 gap-3 mb-6" onSubmit={(e) => { e.preventDefault(); addMember.mutate(); }}>
          <input className="eda-input" placeholder="Nome" value={mNome} onChange={(e) => setMNome(e.target.value)} required />
          <select className="eda-input" value={mRole} onChange={(e) => setMRole(e.target.value as "closer" | "sdr" | "cs")}>
            <option value="closer">Closer</option><option value="sdr">SDR</option><option value="cs">Customer Success</option>
          </select>
          <input type="number" step="0.1" className="eda-input" placeholder="% Comissão" value={mPct} onChange={(e) => setMPct(e.target.value)} />
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={mFounder} onChange={(e) => setMFounder(e.target.checked)} /> Fundador</label>
          <button className="eda-btn" type="submit">Adicionar</button>
        </form>
        <table className="w-full text-sm">
          <thead><tr style={{ color: "var(--text2)" }} className="text-left text-xs uppercase"><th className="py-2">Nome</th><th>Função</th><th>%</th><th>Fundador</th><th>Ações</th></tr></thead>
          <tbody>
            {members?.map((m) => (
              <tr key={m.id} className="border-t" style={{ borderColor: "var(--border)", opacity: m.ativo ? 1 : 0.5 }}>
                <td className="py-2.5 font-medium">
                   <span className="inline-flex items-center gap-2"><Avatar nome={m.nome} foto={mapa.get(m.id)?.foto_url} size={32} /><span>{m.nome}</span></span>
                  {!m.ativo && <span className="ml-2 text-[10px] uppercase" style={{ color: "var(--text3)" }}>Arquivado</span>}
                </td>
                <td className="uppercase text-xs" style={{ color: m.role === "closer" ? "var(--accent)" : "var(--gold)" }}>{m.role}</td>
                <td>{Number(m.comissao_pct)}%</td>
                <td>{m.is_founder ? <span style={{ color: "var(--gold)" }}>Sim</span> : "—"}</td>
                <td>
                  {m.ativo ? (
                    <button
                      type="button"
                      title="Remover membro"
                      className="p-1.5 rounded"
                      style={{ border: "1px solid var(--border)", color: "var(--red)" }}
                      disabled={removeMember.isPending}
                      onClick={() => {
                        if (window.confirm(`Remover o membro "${m.nome}"? Se tiver histórico (vendas, registos), fica arquivado para preservar os dados.`)) {
                          removeMember.mutate(m.id);
                        }
                      }}
                    >
                      <Trash2 size={14} />
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="px-2 py-1 rounded text-xs"
                      style={{ border: "1px solid var(--border)", color: "var(--green)" }}
                      disabled={reactivateMember.isPending}
                      onClick={() => reactivateMember.mutate(m.id)}
                    >
                      Reativar
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

      </div>
    </div>
  );
}
