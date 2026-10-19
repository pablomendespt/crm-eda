import { useState } from "react";
import { Menu } from "lucide-react";
import edaLogo from "@/assets/eda-logo-nova.png.asset.json";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger, SheetDescription } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { NavigationGroups } from "@/components/NavigationGroups";
import { NavigationFooter } from "@/components/NavigationFooter";

export function MobileNav() {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  return (
    <header className="eda-sidebar mobile-navigation flex md:hidden sticky top-0 z-40 items-center justify-between border-b border-border px-4 py-3">
      <img src={edaLogo.url} alt="Europa Digital Academy" className="h-9 w-auto object-contain" />
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild><Button variant="secondary" size="icon" className="min-h-11 min-w-11" aria-label="Abrir menu"><Menu size={20} /></Button></SheetTrigger>
        <SheetContent side="left" className="eda-sidebar flex w-[280px] max-w-full flex-col gap-0 border-border bg-sidebar p-0">
          <SheetHeader className="shrink-0 border-b border-border px-4 py-4">
            <SheetTitle><img src={edaLogo.url} alt="Europa Digital Academy" className="h-9 w-auto object-contain" /></SheetTitle>
            <SheetDescription className="sr-only">Navegação do CRM EDA</SheetDescription>
          </SheetHeader>
          <NavigationGroups onNavigate={close} />
          <NavigationFooter onNavigate={close} />
        </SheetContent>
      </Sheet>
    </header>
  );
}
