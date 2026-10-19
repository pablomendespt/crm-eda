import { Link, useRouterState } from "@tanstack/react-router";
import { useProfile } from "@/hooks/useAuth";
import { routeMatches, visibleGroups } from "@/lib/navigation";

export function NavigationGroups({ onNavigate }: { onNavigate?: () => void }) {
  const { data } = useProfile();
  const pathname = useRouterState({ select: state => state.location.pathname });
  const groups = visibleGroups({ role: data?.role ?? "sdr", isGerencia: !!data?.isGerencia });
  const sections = groups.reduce<{ nome: string; grupos: typeof groups }[]>((acc, g) => {
    const s = acc.find(x => x.nome === g.section);
    if (s) s.grupos.push(g); else acc.push({ nome: g.section, grupos: [g] });
    return acc;
  }, []);
  return (
    <nav aria-label="Navegação principal" className="min-h-0 flex-1 overflow-y-auto px-3 py-4">
      {sections.map(section => (
        <div key={section.nome} className="nav-section">
          <div className="nav-section-label">{section.nome}</div>
          <ul className="space-y-0.5">
            {section.grupos.map(group => {
              const destination = group.items[0];
              if (!destination) return null;
              const active = group.items.some(item => routeMatches(pathname, item.to));
              const Icon = group.icon;
              return (
                <li key={group.id}>
                  <Link to={destination.to} onClick={onNavigate} className="nav-item" data-active={active} aria-current={active ? "page" : undefined}>
                    <Icon size={17} strokeWidth={1.9} /><span>{group.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
