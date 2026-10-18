import { useEffect, useRef } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { useProfile } from "@/hooks/useAuth";
import { activeGroup, routeMatches } from "@/lib/navigation";
import { Button } from "@/components/ui/button";

export function SubNav() {
  const { data } = useProfile();
  const pathname = useRouterState({ select: state => state.location.pathname });
  const nav = useRef<HTMLElement>(null);
  const group = activeGroup(pathname, { role: data?.role ?? "sdr", isGerencia: !!data?.isGerencia });
  useEffect(() => {
    const container = nav.current;
    const current = container?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!container || !current) return;
    container.scrollLeft = Math.max(0, current.offsetLeft - container.offsetLeft - (container.clientWidth - current.offsetWidth) / 2);
  }, [pathname]);
  if (!group || group.noSubNav) return null;
  return (
    <nav ref={nav} aria-label={`Separadores de ${group.label}`} className="group-subnav mb-6 flex max-w-full gap-1 overflow-x-auto border-b border-border">
      {group.items.map(item => {
        const active = routeMatches(pathname, item.to);
        return (
          <Button key={item.to} asChild variant="ghost" className="subnav-link shrink-0" data-active={active}>
            <Link to={item.to} aria-current={active ? "page" : undefined}>{item.label}</Link>
          </Button>
        );
      })}
    </nav>
  );
}
