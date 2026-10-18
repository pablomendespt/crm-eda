import type { ReactNode } from 'react';
import { Link, useRouterState } from '@tanstack/react-router';
import { useProfile } from '@/hooks/useAuth';
import { NAV_GROUPS, canAccessRoute, routeMatches } from '@/lib/navigation';
import { Button } from '@/components/ui/button';

export function RouteAccessBoundary({ children }: { children: ReactNode }) {
  const pathname = useRouterState({ select: s => s.location.pathname });
  const { data, isPending, authLoading, user } = useProfile();
  const restricted = NAV_GROUPS.some(g => g.items.some(i => routeMatches(pathname, i.to)));
  if (!restricted) return children;
  if (!authLoading && !user) return children;
  if (authLoading || isPending) return <p className="p-6 text-muted-foreground">A carregar…</p>;
  if (data && canAccessRoute(pathname, { role: data.role, isGerencia: data.isGerencia })) return children;
  return <main className="min-h-screen flex flex-col items-center justify-center gap-4 bg-background text-foreground px-6">
    <h1 className="text-2xl font-bold">Sem acesso</h1>
    <p className="text-muted-foreground text-center">Não tem permissão para abrir esta área.</p>
    <Button asChild><Link to="/dashboard">Voltar ao Dashboard</Link></Button>
  </main>;
}
