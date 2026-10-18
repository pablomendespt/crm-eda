import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Outlet, createRootRouteWithContext, type ErrorComponentProps } from "@tanstack/react-router";
import { Toaster } from "sonner";
import { RouteAccessBoundary } from "@/components/RouteAccessBoundary";

function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="text-center">
        <h1 className="text-6xl font-bold text-foreground">404</h1>
        <p className="text-muted-foreground mt-2">Página não encontrada.</p>
        <a href="#/" className="eda-btn inline-block mt-6">Voltar</a>
      </div>
    </div>
  );
}

function ErrorPage({ error, reset }: ErrorComponentProps) {
  const message = error instanceof Error ? error.message : String(error ?? "Erro inesperado");
  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="eda-card max-w-md text-center">
        <h1 className="text-xl font-semibold">Algo correu mal</h1>
        <p className="text-sm text-muted-foreground mt-2">{message}</p>
        <button onClick={() => reset()} className="eda-btn mt-4">Tentar novamente</button>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  component: RootComponent,
  notFoundComponent: NotFound,
  errorComponent: ErrorPage,
});

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  return (
    <QueryClientProvider client={queryClient}>
      <RouteAccessBoundary><Outlet /></RouteAccessBoundary>
      <Toaster theme="dark" position="top-right" />
    </QueryClientProvider>
  );
}
