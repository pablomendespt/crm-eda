import { createFileRoute } from "@tanstack/react-router";
import { RegistrarDia } from "@/components/painel/sdr-registrar-dia";
import { MeusNumeros } from "@/components/painel/sdr-numeros";

export const Route = createFileRoute("/_authenticated/sdr/painel")({
  component: PainelSdr,
});

function PainelSdr() {
  return (
    <div className="space-y-10">
      <RegistrarDia />
      <MeusNumeros />
    </div>
  );
}
