import { createClient } from "npm:@supabase/supabase-js@2";

const ALLOWED = ["https://pablomendespt.github.io", "http://localhost:5173", "http://localhost:4173"];

function corsFor(req: Request) {
  const o = req.headers.get("origin") ?? "";
  return {
    "Access-Control-Allow-Origin": ALLOWED.includes(o) ? o : ALLOWED[0],
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ROLES = ["socio", "closer", "sdr", "cs"];

Deno.serve(async (req: Request) => {
  const cors = corsFor(req);
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return json(405, { error: "Método não permitido." });

  const url = Deno.env.get("SUPABASE_URL")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const auth = req.headers.get("Authorization") ?? "";

  const userClient = createClient(url, anon, { global: { headers: { Authorization: auth } } });
  const { data: u, error: uErr } = await userClient.auth.getUser();
  if (uErr || !u?.user) return json(401, { error: "Sessão inválida. Entre de novo." });
  const callerId = u.user.id;

  const admin = createClient(url, service, { auth: { autoRefreshToken: false, persistSession: false } });

  const { data: isGer, error: rErr } = await admin
    .from("user_roles").select("role").eq("user_id", callerId).eq("role", "gerencia").maybeSingle();
  if (rErr) return json(500, { error: rErr.message });
  if (!isGer) return json(403, { error: "Apenas a gerência pode gerir contas." });

  let body: any;
  try { body = await req.json(); } catch { return json(400, { error: "Pedido inválido." }); }
  const action = body?.action;

  try {
    if (action === "create") {
      const { email, password, nome, role, member_id, ativo } = body;
      if (typeof email !== "string" || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json(400, { error: "Email inválido." });
      if (typeof password !== "string" || password.length < 8) return json(400, { error: "Mínimo 8 caracteres" });
      if (typeof nome !== "string" || !nome.trim()) return json(400, { error: "Nome obrigatório." });
      if (!ROLES.includes(role)) return json(400, { error: "Cargo inválido." });
      if (member_id != null && !UUID.test(member_id)) return json(400, { error: "Membro inválido." });

      const { data: created, error: cErr } = await admin.auth.admin.createUser({
        email, password, email_confirm: true, user_metadata: { nome },
      });
      if (cErr || !created?.user) return json(400, { error: cErr?.message ?? "Falha ao criar utilizador." });
      const uid = created.user.id;

      const rollback = async (msg: string) => {
        await admin.auth.admin.deleteUser(uid);
        return json(500, { error: msg });
      };

      const { error: pErr } = await admin.from("profiles")
        .update({ nome, member_id: member_id ?? null, ativo: ativo ?? true }).eq("id", uid);
      if (pErr) return await rollback(pErr.message);

      await admin.from("user_roles").delete().eq("user_id", uid);
      const { error: roleErr } = await admin.from("user_roles").insert({ user_id: uid, role });
      if (roleErr) return await rollback(roleErr.message);

      return json(200, { ok: true, id: uid });
    }

    if (action === "delete") {
      const { user_id } = body;
      if (!UUID.test(user_id ?? "")) return json(400, { error: "Utilizador inválido." });
      if (user_id === callerId) return json(400, { error: "Não pode apagar a sua própria conta." });
      const { error } = await admin.auth.admin.deleteUser(user_id);
      if (error) return json(400, { error: error.message });
      return json(200, { ok: true });
    }

    if (action === "reset") {
      const { user_id, password } = body;
      if (!UUID.test(user_id ?? "")) return json(400, { error: "Utilizador inválido." });
      if (typeof password !== "string" || password.length < 8) return json(400, { error: "Mínimo 8 caracteres" });
      const { error } = await admin.auth.admin.updateUserById(user_id, { password });
      if (error) return json(400, { error: error.message });
      return json(200, { ok: true });
    }

    return json(400, { error: "Ação desconhecida." });
  } catch (e) {
    return json(500, { error: (e as Error).message ?? "Erro inesperado." });
  }
});
