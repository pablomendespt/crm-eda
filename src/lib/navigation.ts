import {
  LayoutDashboard, KanbanSquare, CalendarDays, BarChart3, Wallet, Users, ShieldCheck, Receipt, Archive,
  type LucideIcon,
} from "lucide-react";
import type { AppRole } from "@/hooks/useAuth";

export type NavAccess = { role: AppRole; isGerencia: boolean };
export type NavItem = { to: string; label: string; roles: readonly AppRole[]; managementOnly?: boolean };
export type NavGroup = {
  id: string; label: string; icon: LucideIcon; section: string; items: readonly NavItem[];
  managementOnly?: boolean; noSubNav?: boolean;
};
const all: readonly AppRole[] = ["socio", "closer", "sdr", "cs"];
const comercial: readonly AppRole[] = ["socio", "closer", "sdr"];
const partners: readonly AppRole[] = ["socio"];

export const NAV_GROUPS: readonly NavGroup[] = [
  { id: "funil", label: "Funil", icon: KanbanSquare, section: "Comercial", noSubNav: true, items: [
    { to: "/funil", label: "Funil", roles: all },
  ] },
  { id: "agenda", label: "Agenda", icon: CalendarDays, section: "Comercial", noSubNav: true, items: [
    { to: "/agenda", label: "Agenda", roles: comercial },
  ] },
  { id: "numeros", label: "Números", icon: BarChart3, section: "Comercial", noSubNav: true, items: [
    { to: "/numeros", label: "Números", roles: comercial },
  ] },
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard, section: "Gestão", items: [
    { to: "/dashboard", label: "Dashboard", roles: partners },
    { to: "/visao-geral", label: "Visão Geral", roles: partners },
    { to: "/analise-time", label: "Análise do Time", roles: partners },
    { to: "/anual", label: "Anual", roles: partners },
  ] },
  { id: "vendas", label: "Vendas", icon: Receipt, section: "Gestão", items: [
    { to: "/registro-vendas", label: "Registo de vendas", roles: ["socio", "closer"] },
    { to: "/vendas", label: "Registar venda", roles: partners },
    { to: "/sinais", label: "Sinais", roles: ["socio", "closer"] },
    { to: "/parcelas", label: "Parcelas", roles: ["socio", "closer", "cs"], managementOnly: true },
  ] },
  { id: "pagamentos", label: "Pagamentos", icon: Wallet, section: "Gestão", noSubNav: true, managementOnly: true, items: [
    { to: "/pagamentos", label: "Pagamentos", roles: all },
  ] },
  { id: "equipa", label: "Equipa", icon: Users, section: "Equipa", items: [
    { to: "/membros", label: "Membros", roles: partners },
    { to: "/metas", label: "Metas", roles: all },
    { to: "/recordes", label: "Recordes", roles: all },
  ] },
  { id: "admin", label: "Admin", icon: ShieldCheck, section: "Sistema", managementOnly: true, items: [
    { to: "/equipa", label: "Acessos", roles: partners },
    { to: "/audit-log", label: "Histórico de alterações", roles: partners },
    { to: "/contratos", label: "Contratos", roles: partners },
  ] },
  { id: "arquivo", label: "Arquivo", icon: Archive, section: "Sistema", managementOnly: true, items: [
    { to: "/leads", label: "Leads (antigo)", roles: partners },
    { to: "/pipeline", label: "Pipeline (antigo)", roles: partners },
    { to: "/followups", label: "Follow-ups (antigo)", roles: partners },
    { to: "/noshows", label: "No-shows (antigo)", roles: partners },
    { to: "/recuperacao-leads", label: "Recuperação (antigo)", roles: partners },
    { to: "/registrar-call", label: "Registar dia SDR (antigo)", roles: partners },
    { to: "/validar-calls", label: "Registar dia Closer (antigo)", roles: partners },
    { to: "/closer/painel", label: "Números Closer (antigo)", roles: partners },
    { to: "/sdr/painel", label: "Números SDR (antigo)", roles: partners },
  ] },
];

export function routeMatches(pathname: string, to: string) {
  return pathname === to || pathname.startsWith(`${to}/`);
}

export function visibleGroups(access: NavAccess) {
  return NAV_GROUPS.filter(group => !group.managementOnly || access.isGerencia)
    .map(group => ({ ...group, items: group.items.filter(item => item.roles.includes(access.role) && (!item.managementOnly || access.isGerencia)) }))
    .filter(group => group.items.length > 0);
}

export function activeGroup(pathname: string, access: NavAccess) {
  return visibleGroups(access).find(group => group.items.some(item => routeMatches(pathname, item.to)));
}

/** Direct URL access follows the same permissions as desktop and mobile navigation. */
export function canAccessRoute(pathname: string, access: NavAccess) {
  const group = NAV_GROUPS.find(g => g.items.some(item => routeMatches(pathname, item.to)));
  if (!group) return true;
  return visibleGroups(access).some(g => g.items.some(item => routeMatches(pathname, item.to)));
}
