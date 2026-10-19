import edaLogo from "@/assets/eda-logo-nova.png.asset.json";
import { NavigationGroups } from "@/components/NavigationGroups";
import { NavigationFooter } from "@/components/NavigationFooter";

export function AppSidebar() {
  return (
    <aside aria-label="Barra lateral" className="eda-sidebar desktop-navigation hidden md:flex fixed left-0 top-0 z-50 h-dvh w-64 flex-col border-r border-border">
      <div className="shrink-0 border-b border-border px-5 py-4">
        <img src={edaLogo.url} alt="Europa Digital Academy" className="h-9 w-auto object-contain" />
      </div>
      <NavigationGroups />
      <NavigationFooter />
    </aside>
  );
}
