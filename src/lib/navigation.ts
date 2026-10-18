import { LayoutDashboard, Contact2, CalendarCheck, PlusCircle, Wallet, Users, HeartHandshake, ShieldCheck, type LucideIcon } from "lucide-react";
import type { AppRole } from "@/hooks/useAuth";

export type NavAccess = { role: AppRole; isGerencia: boolean };
export type NavItem = { to: string; label: string; roles: readonly AppRole[] };
export type NavGroup = { id: string; label: string; icon: LucideIcon; items: readonly NavItem[]; managementOnly?: boolean; noSubNav?: boolean };
const all: readonly AppRole[] = ["socio", "closer", "sdr", "cs"];
const sales: readonly AppRole[] = ["socio", "closer", "cs"];
const operations: readonly AppRole[] = ["socio", "closer", "sdr"];
const partners: readonly AppRole[] = ["socio"];

export const NAV_GROUPS: readonly NavGroup[] = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard, items: [
    { to: "/dashboard", label: "Dashboard", roles: all },
    { to: "/visao-geral", label: "Visão Geral", roles: partners },
    { to: "/analise-time", label: "Análise do Time", roles: partners },
    { to: "/anual", label: "Anual", roles: partners },
  ] },
  { id: "leads", label: "Leads", icon: Contact2, items: [
    { to: "/leads", label: "Central de Leads", roles: operations },
    { to: "/followups", label: "Follow-ups", roles: operations },
    { to: "/noshows", label: "No-shows", roles: operations },
    { to: "/recuperacao-leads", label: "Recuperação", roles: operations },
    { to: "/pipeline", label: "Pipeline", roles: operations },
  ] },
  { id: "registrar-dia", label: "Registrar dia", icon: CalendarCheck, items: [
    { to: "/registrar-call", label: "Registrar dia SDR", roles: ["socio", "sdr"] },
    { to: "/validar-calls", label: "Registrar dia Closer", roles: ["socio", "closer"] },
    { to: "/closer/painel", label: "Números Closer", roles: ["socio", "closer"] },
    { to: "/sdr/painel", label: "Números SDR", roles: ["socio", "sdr"] },
  ] },
  { id: "vendas", label: "Vendas", icon: PlusCircle, items: [
    { to: "/vendas", label: "Registar venda", roles: sales },
    { to: "/registro-vendas", label: "Registo de vendas", roles: all },
    { to: "/sinais", label: "Sinais", roles: sales },
  ] },
  { id: "pagamentos", label: "Pagamentos", icon: Wallet, noSubNav: true, managementOnly: true, items: [
    { to: "/pagamentos", label: "Pagamentos", roles: all },
  ] },
  { id: "equipa", label: "Equipa", icon: Users, items: [
    { to: "/membros", label: "Membros", roles: partners },
    { to: "/metas", label: "Metas", roles: all },
    { to: "/recordes", label: "Recordes", roles: all },
  ] },
  { id: "alunos", label: "Alunos", icon: HeartHandshake, noSubNav: true, items: [
    { to: "/customer-success", label: "Alunos", roles: all },
  ] },
  { id: "admin", label: "Admin", icon: ShieldCheck, managementOnly: true, items: [
    { to: "/equipa", label: "Acessos", roles: partners },
    { to: "/audit-log", label: "Histórico de alterações", roles: partners },
    { to: "/contratos", label: "Contratos", roles: partners },
  ] },
];

export function routeMatches(pathname: string, to: string) {
  return pathname === to || pathname.startsWith(`${to}/`);
}

export function visibleGroups(access: NavAccess) {
  return NAV_GROUPS.filter(group => !group.managementOnly || access.isGerencia)
    .map(group => ({ ...group, items: group.items.filter(item => item.roles.includes(access.role)) }))
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
