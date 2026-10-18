import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import edaLogo from "@/assets/eda-logo-nova.png.asset.json";

export const Route = createFileRoute("/reset-password")({
  component: ResetPasswordPage,
});

const passwordSchema = z
  .string()
  .min(8, "Mínimo 8 caracteres")
  .max(72, "Máximo 72 caracteres")
  .regex(/[A-Z]/, "Precisa de uma letra maiúscula")
  .regex(/[a-z]/, "Precisa de uma letra minúscula")
  .regex(/[0-9]/, "Precisa de um número");

function checks(pw: string) {
  return {
    length: pw.length >= 8,
    upper: /[A-Z]/.test(pw),
    lower: /[a-z]/.test(pw),
    number: /[0-9]/.test(pw),
  };
}

function ResetPasswordPage() {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const [invalidLink, setInvalidLink] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      if (data.session) setReady(true);
      else setInvalidLink(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const pwChecks = useMemo(() => checks(password), [password]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const r = passwordSchema.safeParse(password);
    if (!r.success) {
      toast.error(`Senha inválida: ${r.error.issues[0].message}`);
      return;
    }
    if (password !== confirm) {
      toast.error("As senhas não coincidem.");
      return;
    }
    setLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      toast.success("Senha redefinida. Já podes entrar.");
      await supabase.auth.signOut();
      navigate({ to: "/auth" });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Não foi possível redefinir a senha.";
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4" style={{ background: "var(--bg)" }}>
      <div className="w-full max-w-md eda-card" style={{ padding: 32 }}>
        <div className="flex flex-col items-center gap-2 mb-8">
          <img src={edaLogo.url} alt="Europa Digital Academy" style={{ height: 140, width: "auto", objectFit: "contain" }} />
        </div>

        <h1 className="text-xl font-semibold mb-1">Redefinir senha</h1>
        <p className="text-sm mb-6" style={{ color: "var(--text2)" }}>
          Escolhe uma nova senha para a tua conta.
        </p>

        {invalidLink ? (
          <div className="space-y-3">
            <p className="text-sm" style={{ color: "var(--text2)" }}>
              Este link de redefinição é inválido ou já expirou. Pede um novo a partir do ecrã de entrada.
            </p>
            <button onClick={() => navigate({ to: "/auth" })} className="eda-btn w-full">
              Voltar ao login
            </button>
          </div>
        ) : !ready ? (
          <p className="text-sm" style={{ color: "var(--text2)" }}>A validar link…</p>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-3">
            <div>
              <label className="text-xs font-medium" style={{ color: "var(--text2)" }}>Nova senha</label>
              <input
                type="password"
                autoComplete="new-password"
                className="eda-input mt-1"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
                maxLength={72}
              />
              {password.length > 0 && (
                <ul className="mt-2 text-[11px] space-y-0.5" style={{ color: "var(--text2)" }}>
                  <li style={{ color: pwChecks.length ? "var(--neon, #39ff88)" : undefined }}>
                    {pwChecks.length ? "✓" : "•"} Mínimo 8 caracteres
                  </li>
                  <li style={{ color: pwChecks.upper ? "var(--neon, #39ff88)" : undefined }}>
                    {pwChecks.upper ? "✓" : "•"} Uma letra maiúscula
                  </li>
                  <li style={{ color: pwChecks.lower ? "var(--neon, #39ff88)" : undefined }}>
                    {pwChecks.lower ? "✓" : "•"} Uma letra minúscula
                  </li>
                  <li style={{ color: pwChecks.number ? "var(--neon, #39ff88)" : undefined }}>
                    {pwChecks.number ? "✓" : "•"} Um número
                  </li>
                </ul>
              )}
            </div>
            <div>
              <label className="text-xs font-medium" style={{ color: "var(--text2)" }}>Confirmar senha</label>
              <input
                type="password"
                autoComplete="new-password"
                className="eda-input mt-1"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
              />
            </div>
            <button type="submit" disabled={loading} className="eda-btn w-full mt-2" style={{ opacity: loading ? 0.6 : 1 }}>
              {loading ? "A guardar..." : "Redefinir senha"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
