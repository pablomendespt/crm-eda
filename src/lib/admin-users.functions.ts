// Stub: versão estática (SPA) sem funções de servidor.
export async function createTeamUser(
  _opts?: {
    data: {
      email: string;
      password: string;
      nome: string;
      role: "socio" | "closer" | "sdr" | "cs";
      member_id?: string | null;
      ativo?: boolean;
    };
  } | unknown,
): Promise<{ ok: boolean; id: string }> {
  throw new Error("Funcionalidade indisponível nesta versão");
}

export async function deleteTeamUser(
  _opts?: { data: { user_id: string } } | unknown,
): Promise<{ ok: boolean }> {
  throw new Error("Funcionalidade indisponível nesta versão");
}

export async function resetTeamUserPassword(
  _opts?: { data: { user_id: string; password: string } } | unknown,
): Promise<{ ok: boolean }> {
  throw new Error("Funcionalidade indisponível nesta versão");
}
