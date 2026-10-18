import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/salarios-comissoes")({
  beforeLoad: () => { throw redirect({ to: "/pagamentos", replace: true }); },
});
