import { createFileRoute, Outlet, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useProfile } from "@/hooks/useAuth";
import { useRealtimeSync } from "@/hooks/useRealtime";
import { useHealthCheck } from "@/hooks/useHealthCheck";
import { AppSidebar } from "@/components/AppSidebar";
import { MobileNav } from "@/components/MobileNav";
import { HealthCheckError } from "@/components/HealthCheckError";
import { SubNav } from "@/components/SubNav";

export const Route = createFileRoute("/_authenticated")({
  component: AuthLayout,
});

function AuthLayout() {
  const navigate = useNavigate();
  const { data, isLoading, user, authLoading } = useProfile();
  const { status: healthStatus, failedTables } = useHealthCheck();
  useRealtimeSync();

  useEffect(() => {
    if (!authLoading && !user) navigate({ to: "/auth", replace: true });
  }, [authLoading, user, navigate]);

  useEffect(() => {
    if (!isLoading && data && data.profile && !data.profile.ativo) {
      navigate({ to: "/auth", replace: true });
    }
  }, [isLoading, data, navigate]);

  if (authLoading || isLoading || healthStatus === "checking") {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "var(--bg)" }}>
        <div className="text-sm" style={{ color: "var(--text2)" }}>A carregar...</div>
      </div>
    );
  }

  if (healthStatus === "failed") {
    return <HealthCheckError failedTables={failedTables} onRetry={() => window.location.reload()} />;
  }

  if (!user || !data?.profile?.ativo) return null;

  return (
    <div className="authenticated-shell min-h-screen" style={{ background: "var(--bg)" }}>
      <AppSidebar />
      <MobileNav />
      <main className="relative z-10 min-h-screen md:ml-64">
        <div className="max-w-[1400px] mx-auto px-4 py-6 md:px-6 md:py-8">
          <SubNav />
          <Outlet />
        </div>
      </main>
    </div>
  );
}
