# WhatsApp Web — checkpoint 2, serviço isolado (2026-10-10)

Baileys7.0.0-rc14 autorizado pelo usuário e fixado com lock próprio; provider Docker
independente implementado em services/wapphub-provider-web. Vault criptografado,
writer lock de kernel, ciclo de sessão/QR/reconexão limitada, transporte interno
HMAC com replay persistido e journal de eventos CP1 com leases/ack/dead letter.
35 testes do serviço e npm ci/lint/typecheck/build/audit aprovados localmente;
regressão Core/CI/Docker/deploy possuem gates separados e evidências externas.
Compose bloqueia conexões: sem contas reais. Sem mudança de Core API/Worker,
Chat/RBAC/schema/REST/realtime/Meta/Demo. Consumer Core, UI QR/envio/mídia permanecem
pendentes do checkpoint3; nenhuma homologação funcional humana presumida.
[Checkpoint2: contrato, segurança e operação](WHATSAPP_WEB_CHECKPOINT2.md).

# WhatsApp Web — checkpoint 1 de normalização (histórico, 2026-10-10)

Auditoria prévia versionada; contrato interno universal, parser estrito e normalização
compartilhada de texto Demo implementados. Nenhum SDK no domínio Core.
Validação local: npm ci/lint/typecheck/build/OpenAPI/Prisma/drift e84 testes aprovados;
benchmark sintético medido, restrito ao normalizador. Schema/REST/RBAC/realtime inalterados.
CI/merge/publicação seguem gates. Serviço Web/QR/filas/mídia/UI não implementados nem
habilitados neste checkpoint; escolha de versão Baileys pendente do usuário.
[Auditoria](WHATSAPP_WEB_AUDIT.md) · [Contrato e limites](PROVIDER_CONTRACT.md).
Registros abaixo são históricos; não declara homologação do novo provider.

# M2.1 — atualização técnica de 2026-10-09

Catálogo base, overrides GRANT/REVOKE por Membership, APIs de equipe/permissões,
resolver efetivo, auditoria/revisão concorrente e invalidação realtime implementados.
Validação local: 75 testes Core (inclui regressão M1), npm ci sem vulnerabilidades,
lint/typecheck/build/OpenAPI/Prisma aprovados; zero drift novo.
PR/merge/deploy seguem gates separados; homologação final pelo usuário pendente.
Não declara assinaturas, entitlements comerciais, convites ou Meta implementados.
[Diagnóstico](M2_1_RBAC_DIAGNOSIS.md) · [Contrato/segurança](M2_1_RESOURCES_RBAC.md).

Os registros abaixo preservam o estado histórico anterior a esta entrega.

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
