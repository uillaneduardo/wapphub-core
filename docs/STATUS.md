# Estado vigente — WhatsApp Web CP4 (11/10/2026)

Sincronização contínua publicada e funcionalmente homologada pelo usuário: recebimento realtime, persistência, deduplicação, saída pelo celular, identificação visual e diagnóstico aprovados. Latência observada aproximadamente1 segundo, sem promessa de SLA. [Aceite formal](WHATSAPP_WEB_CP4_ACCEPTANCE.md).

Histórico anterior à conexão excluído do aceite. Sua [preparação/auditoria](WHATSAPP_WEB_HISTORY_PREPARATION.md) é o escopo atual; importação real exige autorização específica. As14 falhas legadas permanecem sem causas reconstruídas. CP5, envio pelo Chat e download de mídias não iniciados. Os registros anteriores abaixo descrevem entregas históricas e não substituem este estado vigente.

> Retomada 2026-10-11: Core/API/Worker PR15 e Chat PR13/14 publicados, migrations10 e serviços correspondentes saudáveis. Runtime Provider anterior permanece vivo/readiness503/socket0; auth preservada e recuperação específica aguardando autorização. Homologação manual/CP4 ainda pendentes. Correção adicional de isolamento de falhas do Provider validada com53 testes/lint/types/build, CI/ativação separados. Registros antigos abaixo são históricos.

# WhatsApp Web — Checkpoint 4 publicado tecnicamente (2026-10-10)

Core/API/Worker/Provider9423b0b e Chat0b6b2ee publicados; 115 testes Core,
47 Provider,256 Chat e gates de CI/lint/typecheck/build/OpenAPI/drift aprovados.
Migration/backup/restore verificados; seis serviços healthy, sessão real existente
CONNECTED e mesmo QR, Demo preservado. Histórico real desativado, aguardando
autorização específica; homologação funcional/visual manual pendente. Envio pelo
Chat e download completo de mídia continuam bloqueados. CP5 não iniciado.
[Relatório técnico](DEPLOY_WHATSAPP_WEB_CP4_20261010.md).

O conteúdo abaixo preserva os registros anteriores.

# WhatsApp Web — Checkpoint 3 publicado (2026-10-10)

Merge e deploy técnico concluídos: Core/API/Worker e Provider `42a7651`, Chat
`da38c2f`. Migration aditiva aplicada com backup fresco/restauração verificada;
seis serviços healthy, endpoints/HTTPS/assets/rotas/heartbeat conferidos.
103 testes Core, 36 Provider e 249 Chat confirmados; CI de PRs e merges aprovado.
Provider privado, zero sessões/contas reais; 37 outros containers preservados.
Homologação manual do Checkpoint 4 pelo usuário permanece pendente; envio pelo
Chat e multimídia continuam bloqueados. Nenhum browser executado no Homelab.

[Relatório de publicação](DEPLOY_WHATSAPP_WEB_CP3_20261010.md).

O conteúdo abaixo preserva o registro anterior à publicação.

# WhatsApp Web — checkpoint 3, Core/Worker/Chat (2026-10-10)

Gerenciamento de conexão e QR implementado no Chat pela Core API, usando
providers.manage efetiva, tenant/CSRF e versões concorrentes. QR temporário restrito,
sem persistência/WS/log; Worker consome journal normalizado CP1 com outbox/inbox/lease,
texto original e autoria externa, deduplicação e commit-before-ack. Demo preservado.
Migration aditiva validada em restauração isolada, dados/perfis preservados.
103 testes Core (mais regressão direcionada final), 36 Provider e 249 Chat aprovados
localmente; lint/typecheck/build/OpenAPI/drift/audits verificados. CI/merge/deploy
seguem gates separados e são registrados no homelab. Não há homologação humana.
Envio pelo Chat e multimídia permanecem bloqueados; nenhuma conta real foi conectada.
[Contrato, segurança, limites e rollback](WHATSAPP_WEB_CHECKPOINT3.md).

O conteúdo abaixo preserva os checkpoints históricos.

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

Correção CP4 e diagnóstico contextual implementados: filtro inicial da Inbox conforme permissões, observabilidade do Core e painel somente leitura em Provedores. Gates técnicos/deploy desta revisão em validação. As duas falhas legadas não têm detalhes reconstruíveis. A homologação funcional/visual continua pendente; CP5 não iniciado. A sessão autenticada será preservada; o runtime encontrado indisponível exige diagnóstico e autorização específica antes de qualquer reconexão.

Padronização de autoria incorporada à correção: REST senderName nullable por relações existentes, sem novo campo persistente, autoria por IDs conservada inclusive em histórico/renomeação. Interface operacional recebe nomes e capacidades genéricas, enquanto providers continuam nos metadados internos. Nenhuma migration de autoria. Homologação final pelo usuário permanece pendente.

Retomada adicional em validação: apresentação amigável de contatos no Core, busca/filtros avançados, evidências do pipeline e diagnóstico de indisponibilidade. Platform permanece documental e separado do atendimento. Não declarar CP4 homologado; produção ainda não recebeu estas alterações.

## Estado vigente — CP4.6 (11/10/2026)

As notas de validação CP4 acima são históricas: o usuário homologou a sincronização contínua, persistência/deduplicação, saída pelo celular, identificação e diagnóstico, com latência observada de aproximadamente 1s. Ver WHATSAPP_WEB_CP4_ACCEPTANCE.md. As 14 falhas legadas não têm causas reconstruídas.

CP4.6 implementa importação controlada, outbox/manifest aditivo, limites protobuf, cursor/backpressure, controles administrativos e Inbox metadata-only. Validação técnica e publicação rastreadas no relatório específico do homelab; homologação visual CP4.6 pendente. Execução histórica real bloqueada no Core/Provider; recuperação na conta atual não comprovada sem requisição autorizada. Ver WHATSAPP_WEB_CP46.md. CP5/envio/multimídia não iniciados.

CP4.7: grant persistente scoped, coordenação automática no Worker e piloto limitado implementados. Contrato/limites em [WHATSAPP_WEB_CP47.md](WHATSAPP_WEB_CP47.md). Testes e deploy registrados em `~/homelab/deploy-records/wapphub-provider-web/20261011-cp47-auto-history-ui/`. Recuperação real ainda não homologada; nenhuma autorização criada pelo deploy.
