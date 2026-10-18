import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/alunos-recorrentes")({
  beforeLoad: () => { throw redirect({ to: "/pagamentos", replace: true }); },
});
