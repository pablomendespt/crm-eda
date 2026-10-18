# Edge Functions

Deploy no projeto `htiicujsscbzjteuozwd` (pelo Claude, via MCP do Supabase, ou `supabase functions deploy`).

- `admin-users`: criar, apagar e redefinir senha de contas (só gerência). verify_jwt = true.
- `resumo-ia`: Resumo com IA do desempenho (só sócios). Precisa do secret `ANTHROPIC_API_KEY`. verify_jwt = true.

`resumo-ia/index.ts` é a cópia do que está publicado; mantenha as duas iguais.
