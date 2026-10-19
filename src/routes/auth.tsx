import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import edaLogo from "@/assets/eda-logo-nova.png.asset.json";

export const Route = createFileRoute("/auth")({
  component: AuthPage,
});

const emailSchema = z
  .string()
  .trim()
  .min(1, "Email é obrigatório")
  .max(255, "Email demasiado longo")
  .email("Email inválido");

function AuthPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState(() =>
    typeof window !== "undefined" ? localStorage.getItem("eda:lastEmail") ?? "" : ""
  );
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(() =>
    typeof window !== "undefined" ? localStorage.getItem("eda:remember") !== "false" : true
  );
  const [loading, setLoading] = useState(false);
  const [resetSentAt, setResetSentAt] = useState<number | null>(null);
  const [countdown, setCountdown] = useState(0);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ to: "/funil" });
    });
  }, [navigate]);

  useEffect(() => {
    if (countdown <= 0) return;
    const id = setInterval(() => setCountdown((c) => c - 1), 1000);
    return () => clearInterval(id);
  }, [countdown]);

  useEffect(() => {
    setResetSentAt(null);
    setCountdown(0);
  }, [email]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    const emailRes = emailSchema.safeParse(email);
    if (!emailRes.success) {
      toast.error(emailRes.error.issues[0].message);
      return;
    }
    const cleanEmail = emailRes.data;

    if (!password) {
      toast.error("Insere a senha");
      return;
    }

    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email: cleanEmail, password });
      if (error) throw error;
      const { data: u } = await supabase.auth.getUser();
      if (u.user) {
        const { data: profile } = await supabase
          .from("profiles")
          .select("ativo")
          .eq("id", u.user.id)
          .maybeSingle();
        if (!profile?.ativo) {
          await supabase.auth.signOut();
          toast.error("A sua conta ainda não foi ativada por um sócio.");
          setLoading(false);
          return;
        }
      }
      if (remember) {
        localStorage.setItem("eda:lastEmail", cleanEmail);
        localStorage.setItem("eda:remember", "true");
      } else {
        localStorage.removeItem("eda:lastEmail");
        localStorage.setItem("eda:remember", "false");
      }
      localStorage.removeItem("eda:lastPassword");
      navigate({ to: "/funil" });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erro";
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }

  async function sendReset(emailToReset: string) {
    const r = emailSchema.safeParse(emailToReset);
    if (!r.success) {
      toast.error("Introduz o teu email primeiro para receberes o link.");
      return;
    }
    setLoading(true);
    try {
      await supabase.auth.resetPasswordForEmail(r.data, {
        redirectTo: `${window.location.origin}${window.location.pathname}`,
      });
      toast.success(
        "Se existir uma conta com esse email, enviámos um link para redefinires a senha. Verifica a tua caixa de entrada e o spam.",
        { duration: 7000 }
      );
      setResetSentAt(Date.now());
      setCountdown(60);
    } catch {
      toast.success(
        "Se existir uma conta com esse email, enviámos um link para redefinires a senha.",
        { duration: 7000 }
      );
      setResetSentAt(Date.now());
      setCountdown(60);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4" style={{ background: "var(--bg)" }}>
      <div className="w-full max-w-md eda-card" style={{ padding: 32 }}>
        <div className="flex flex-col items-center gap-2 mb-8">
          <img src={edaLogo.url} alt="Europa Digital Academy" style={{ height: 180, width: "auto", objectFit: "contain" }} />
        </div>

        <h1 className="text-xl font-semibold mb-1">Entrar</h1>
        <p className="text-sm mb-6" style={{ color: "var(--text2)" }}>
          Acesso restrito à equipa EDA. As contas são criadas por um sócio.
        </p>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="text-xs font-medium" style={{ color: "var(--text2)" }}>Email</label>
            <input type="email" autoComplete="email" className="eda-input mt-1" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          <div>
            <label className="text-xs font-medium" style={{ color: "var(--text2)" }}>Senha</label>
            <input
              type="password"
              autoComplete="current-password"
              className="eda-input mt-1"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={1}
              maxLength={72}
            />
          </div>
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <label className="flex items-center gap-2 text-xs cursor-pointer select-none" style={{ color: "var(--text2)" }}>
                <input
                  type="checkbox"
                  checked={remember}
                  onChange={(e) => setRemember(e.target.checked)}
                  style={{ accentColor: "var(--gold, #c9a961)" }}
                />
                Manter-me ligado neste dispositivo
              </label>
              <button
                type="button"
                onClick={() => sendReset(email)}
                disabled={countdown > 0}
                className="text-xs underline"
                style={{ color: countdown > 0 ? "var(--text2)" : "var(--gold)", opacity: countdown > 0 ? 0.6 : 1 }}
              >
                {resetSentAt ? (countdown > 0 ? `Reenviar email (${countdown}s)` : "Reenviar email") : "Esqueci-me da senha"}
              </button>
            </div>
            {resetSentAt && (
              <p className="text-[11px]" style={{ color: "var(--neon, #39ff88)" }}>
                Link enviado. Não recebeste? Podes reenviar {countdown > 0 ? `em ${countdown}s` : "agora"}.
              </p>
            )}
          </div>
          <button type="submit" disabled={loading} className="eda-btn w-full mt-2" style={{ opacity: loading ? 0.6 : 1 }}>
            {loading ? "A carregar..." : "Entrar"}
          </button>
        </form>

      </div>
    </div>
  );
}
