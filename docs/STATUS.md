# Status do WappHub — M1

Estado vigente em 2026-10-08: **M1 funcionalmente homologado pelo usuário; encerramento administrativo pendente de consolidação Git revisada.** Não iniciar M2 nesta execução.

| Dimensão | Estado |
| --- | --- |
| Produção Core/API e Worker | a45fb330ceeb6a703c463174f4fa560ad070e226 / wapphub-core:m1-contacts-a45fb33; healthy |
| Produção Chat | 6b04e653d03fa5b06aafad205b9c760072c01fd0 / wapphub-chat:m1-contacts-6b04e65; healthy |
| MariaDB/Redis | Healthy, preservados desde os deploys anteriores |
| Testes última entrega | 64 Core + 160 Chat; manifests correspondem às fontes; não reexecutados |
| Lint/typecheck/build/Prisma/OpenAPI | Evidências anteriores aprovadas e reaproveitadas; OpenAPI público conferido |
| P0 autorização | Publicado/homologado: 5 cenários declarados pelo usuário |
| P1 realtime | Publicado/homologado: 7 cenários declarados pelo usuário |
| Contatos/criação manual/reutilização | Publicado/homologado: 9 cenários finais declarados pelo usuário |
| M1 critérios funcionais | Atendidos conforme matriz, evidências automáticas/históricas e homologação declarada |
| Integração Git | Branch integration/m1-accepted-20261008 preparada; main remota anterior à produção; push/merge não autorizados |
| M2/Meta/mídia/MVP comercial | Não iniciados nesta execução; roadmap original preservado |

[Aceite formal e matriz vigente](M1_FINAL_ACCEPTANCE.md) · [inventário e estratégia Git](M1_FINAL_GIT_CONSOLIDATION.md) · [releases](M1_RELEASE_HISTORY.md) · [deploy atual](DEPLOY_M1_CONTACTS_20261008.md).

Limites explícitos: criação interna apenas; Meta M3; reutilização opt-in sem unicidade global; sem evento Contact dedicado; replay/reconciliação sem exatamente uma vez/offline; catálogo Tags UI e Demo retry/autoria P2 parciais; benchmark/restore M5 não realizados. Ver matriz para análise de cada limite, sem afirmar funcionalidades inexistentes.

## Histórico preservado

[STATUS integral anterior ao aceite final](history/STATUS_BEFORE_M1_FINAL_20261008.md). Referências históricas à publicação/homologação pendente ou imagens anteriores descrevem o momento da respectiva entrega, não o estado vigente. Registros técnicos e rollback antigos permanecem nos documentos de cada release; nunca retornar Core anterior ao P0.
