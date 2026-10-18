import { Link, useRouterState } from "@tanstack/react-router";
import { useProfile } from "@/hooks/useAuth";
import { routeMatches, visibleGroups } from "@/lib/navigation";
import { Button } from "@/components/ui/button";

export function NavigationGroups({ onNavigate }: { onNavigate?: () => void }) {
  const { data } = useProfile();
  const pathname = useRouterState({ select: state => state.location.pathname });
  const groups = visibleGroups({ role: data?.role ?? "sdr", isGerencia: !!data?.isGerencia });
  return (
    <nav aria-label="Navegação principal" className="min-h-0 flex-1 overflow-y-auto p-3 space-y-1">
      {groups.map(group => {
        const destination = group.items[0];
        if (!destination) return null;
        const active = group.items.some(item => routeMatches(pathname, item.to));
        const Icon = group.icon;
        return (
          <Button asChild variant="ghost" key={group.id} className="sidebar-nav-item nav-group-link" data-active={active}>
            <Link to={destination.to} onClick={onNavigate} aria-current={active ? "page" : undefined}>
              <Icon size={18} /><span>{group.label}</span>
            </Link>
          </Button>
        );
      })}
    </nav>
  );
}
