import { createFileRoute } from "@tanstack/react-router";
import { RegistrarDiaCloser } from "@/components/painel/closer-registrar-dia";
import { MeusNumerosCloser } from "@/components/painel/closer-numeros";

export const Route = createFileRoute("/_authenticated/closer/painel")({
  component: PainelCloser,
});

function PainelCloser() {
  return (
    <div className="space-y-10">
      <RegistrarDiaCloser />
      <MeusNumerosCloser />
    </div>
  );
}
