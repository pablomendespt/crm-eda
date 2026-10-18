import { createFileRoute, Navigate } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/comparativo")({
  component: () => <Navigate to="/anual" replace />,
});
