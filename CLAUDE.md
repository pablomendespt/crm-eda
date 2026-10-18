# CRM EDA — instruções para o Claude

CRM interno da Europa Digital Academy (Pablo Mendes e Leandro Santana). Responder ao Pablo em português do Brasil, simples e direto.
**Nada aqui depende do Lovable.** Alterações no CRM são feitas neste repositório, pelo Claude.

## Como funciona
- App estático: Vite + React 19 + TanStack Router (hash history, rotas em `src/routes`, geradas em `src/routeTree.gen.ts`) + Tailwind 4 + TanStack Query.
- Banco e login: Supabase (projeto `htiicujsscbzjteuozwd`), cliente em `src/integrations/supabase/client.ts` (chave publicável, pública por desenho). Toda a segurança está no banco (RLS e funções RPC). Regras de negócio financeiras ficam no banco (`fin_*`, `relatorio_dia`, `call_*`).
- Publicação: GitHub Pages a partir da pasta `docs/` da branch `main`. Site: https://pablomendespt.github.io/crm-eda/

## Para alterar e publicar
1. `npm install` (primeira vez) e editar em `src/`.
2. `npm run build:docs` (gera `docs/`), conferir e fazer commit + push na `main`.
3. O site atualiza em ~1 minuto.

## Notas
- Esquema do banco: `db/` guarda as mudanças feitas fora do Lovable (ex.: histórico de sinais). Mudanças no banco devem ser testadas com rollback antes.
- Funções de servidor = Edge Functions do Supabase (código em `supabase/functions/`): `admin-users` (criar/apagar/redefinir senha na tela Equipa) e `resumo-ia` (Resumo com IA, usa o secret `ANTHROPIC_API_KEY`). Chamadas por `src/lib/edge.ts`.
- O projeto Supabase é da organização "Europa Digital Academy" (conta do Pablo). O antigo (Lovable/Cloud) fica só como backup, nunca mais usar.
- Linhas vermelhas do negócio: nunca prometer resultado, dados internos (salários, comissões, leads) nunca em conteúdo público.
