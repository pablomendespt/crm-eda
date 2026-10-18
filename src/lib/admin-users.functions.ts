import { callEdge } from "./edge";

// Gestão de contas via Edge Function `admin-users` (só a gerência).
export async function createTeamUser(opts: {
  data: {
    email: string;
    password: string;
    nome: string;
    role: "socio" | "closer" | "sdr" | "cs";
    member_id?: string | null;
    ativo?: boolean;
  };
}): Promise<{ ok: boolean; id: string }> {
  return callEdge("admin-users", { action: "create", ...opts.data });
}

export async function deleteTeamUser(opts: { data: { user_id: string } }): Promise<{ ok: boolean }> {
  return callEdge("admin-users", { action: "delete", ...opts.data });
}

export async function resetTeamUserPassword(
  opts: { data: { user_id: string; password: string } },
): Promise<{ ok: boolean }> {
  return callEdge("admin-users", { action: "reset", ...opts.data });
}
