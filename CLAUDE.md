# CRM EDA — instruções para o Claude

CRM interno da Europa Digital Academy (Pablo Mendes e Leandro Santana). Responder ao Pablo em português do Brasil, simples e direto.
**Nada aqui depende do Lovable.** Alterações no CRM são feitas neste repositório, pelo Claude.

## Como funciona
- App estático: Vite + React 19 + TanStack Router (hash history, rotas em `src/routes`, geradas em `src/routeTree.gen.ts`) + Tailwind 4 + TanStack Query.
- Banco e login: Supabase (projeto `vuqbuuvtcxiongzhwtqz`), cliente em `src/integrations/supabase/client.ts` (chave publicável, pública por desenho). Toda a segurança está no banco (RLS e funções RPC). Regras de negócio financeiras ficam no banco (`fin_*`, `relatorio_dia`, `call_*`).
- Publicação: GitHub Pages a partir da pasta `docs/` da branch `main`. Site: https://pablomendespt.github.io/crm-eda/

## Para alterar e publicar
1. `npm install` (primeira vez) e editar em `src/`.
2. `npm run build:docs` (gera `docs/`), conferir e fazer commit + push na `main`.
3. O site atualiza em ~1 minuto.

## Notas
- Esquema do banco: `db/` guarda as mudanças feitas fora do Lovable (ex.: histórico de sinais). Mudanças no banco devem ser testadas com rollback antes.
- Indisponíveis nesta versão: criar usuário pela tela Equipa e Resumo com IA (precisam de servidor; stubs em `src/lib/*.functions.ts`).
- Linhas vermelhas do negócio: nunca prometer resultado, dados internos (salários, comissões, leads) nunca em conteúdo público.
