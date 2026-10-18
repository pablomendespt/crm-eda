import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";
import { getRouter } from "./router";
import { supabase } from "@/integrations/supabase/client";
import "./styles.css";

async function bootstrap() {
  // Links de recuperação de senha do Supabase chegam como #access_token=...&type=recovery
  const h = window.location.hash;
  if (h.includes("access_token=") && h.includes("type=recovery")) {
    const p = new URLSearchParams(h.replace(/^#\/?/, ""));
    const access_token = p.get("access_token");
    const refresh_token = p.get("refresh_token");
    if (access_token && refresh_token) {
      try { await supabase.auth.setSession({ access_token, refresh_token }); } catch { /* ignore */ }
    }
    window.history.replaceState(null, "", window.location.pathname + "#/reset-password");
  }
  const router = getRouter();
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <RouterProvider router={router} />
    </StrictMode>,
  );
}
bootstrap();
