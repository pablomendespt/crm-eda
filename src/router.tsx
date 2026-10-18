import { QueryCache, MutationCache, QueryClient } from "@tanstack/react-query";
import { createRouter, createHashHistory } from "@tanstack/react-router";
import { toast } from "sonner";
import { routeTree } from "./routeTree.gen";
import { friendlyError, isRlsError } from "./lib/rls-error";

export const getRouter = () => {
  const shown = new Set<string>();
  const notify = (err: unknown, source: "query" | "mutation") => {
    const msg = friendlyError(err);
    if (!msg) return;
    if (source === "query") {
      if (shown.has(msg)) return;
      shown.add(msg);
      setTimeout(() => shown.delete(msg), 4000);
    }
    if (isRlsError(err)) toast.error(msg, { duration: 6000 });
    else toast.error(msg);
  };

  const queryClient = new QueryClient({
    queryCache: new QueryCache({ onError: (err) => notify(err, "query") }),
    mutationCache: new MutationCache({
      onError: (err, _vars, _ctx, mutation) => {
        if (mutation.options.onError) return;
        notify(err, "mutation");
      },
    }),
  });

  return createRouter({
    routeTree,
    context: { queryClient },
    history: createHashHistory(),
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
  });
};
