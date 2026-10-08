# Status de Implementação

> Atualização de produção — 2026-10-08, 15:00 Recife: P0 publicado em Core/API/Worker
> `cbaf50c5eedd6731e1ca3a674c1d9b0b20005a7d` (`wapphub-core:p0-preview-cbaf50c`)
> e Chat `d93efc576bd560fcbab0146343fb98bbbc1d0b69` (`wapphub-chat:p0-preview-d93efc5`).
> Todos os cinco serviços healthy; HTTP, assets e integridade aprovados.
> Validação funcional isolada anterior reaproveitada: 58 Core + 91 Chat; não reexecutada.
> Homologação visual desta publicação pendente. A2 e demais aceites M1 permanecem;
> M1 não formalmente encerrado. M2/P1 não iniciados.
> [Registro de publicação e contingência](DEPLOY_P0_20261008.md).

## Registro histórico anterior à publicação P0

## Estado verificado — 2026-10-08

**M1 operacional, sem encerramento formal; M2 apenas planejado.**
Produção Core `72d05aa8c0a3c9f12a8c17abb25ad737b88c65af` / `wapphub-core:demo-72d05aa`;
Chat `3e234522673023a64f6bd7c827ca1adef35aaa0b` / `wapphub-chat:lucide-nav-3e23452`.
Containers/imagens, código Core, OpenAPI e seis migrations conferidos em leitura.
API/Worker/MariaDB/Redis/Chat healthy; health/readiness e bundle público aprovados.
WEB_ORIGINS atual: https://chat.wapphub.com.br. Roster integrado pelo PR #6;
Demo publicado mas dois commits ainda locais, não presentes na main remota fa292c4.
PR documental #7 continua draft e sua nota foi incorporada com complemento auditado.

| Item atual | Estado e evidência |
| --- | --- |
| Fundação/auth/contexto/RBAC | Implementado e validado; suíte Core e operação M1 |
| Chat REST/WS/persistência/idempotência | Implementado e validado dentro da cobertura; 56 testes reexecutados |
| Demo/ingestão/port/roster | Implementado e publicado; 56 testes, fingerprints e contrato público |
| Frontend operacional/Demo/visual | Implementado e homologado conforme relato do usuário; 86 testes Chat |
| Preview e visibilidade transferida | Parcial; bloqueador A1: prévia ignora messages.read/limite NONE |
| Realtime integrado/reconnect cliente | Parcial; bloqueador A2: checkpoint antes da aplicação REST |
| Multi-Organization ponta a ponta | Implementado, sem evidência integrada suficiente; verificar fila/cancelamento |
| Contacts/criação manual UI | Parcial/pendente; ver matriz frontend, não inferir de endpoints |
| Integração Git de produção | Pendente: Core2 + Chat10 commits funcionais/documentais publicados fora das main |
| Entitlements/seats/convites comerciais/Admin/Minha Conta | Não implementados; plano M2 proposto |
| Meta/mídia/100 agentes/MVP comercial | Milestones posteriores preservados |

Lint/typecheck/build/OpenAPI e 56 testes Core passaram novamente no projeto
isolado wapphub-m1-test; lint/typecheck/build e 86 testes Chat passaram sem browser.
Isso não elimina as contraprovas sintéticas adicionais A1/A2. Homologações
visuais/operacionais do usuário são aceitas como relato, sem inventar matriz
completa de viewports, touch/AT ou testes negativos em produção.

Fontes: [inventário](GIT_PRODUCTION_INVENTORY_20261008.md),
[matriz/arquitetura](M1_ARCHITECTURE_ACCEPTANCE_20261008.md),
[nota remota preservada](M1_PRODUCTION_RECONCILIATION_20261008.md),
[integração Git](GIT_INTEGRATION_STRATEGY_20261008.md),
[plano M2](M2_TECHNICAL_PLAN.md).
Não houve deploy, migrations, seeds, mudanças de produção, merge ou push.

## Histórico anterior preservado

O conteúdo abaixo registra entregas nas datas/branches originais; referências
antigas a produção M0, roster não integrado, WEB_ORIGINS vazio ou Demo não
publicado são snapshots históricos, superados pelo estado verificado acima.
Os testes originais e critérios não foram apagados nem usados para inferir M1
completo. A fonte do estado corrente é a seção inicial e a matriz auditada.


Atualizar este arquivo em todo PR/entrega que altere o estado funcional do projeto.

Legenda:
- ✅ Implementado e validado
- 🟡 Em andamento
- ⬜ Planejado
- ⛔ Fora do escopo atual

## Estado geral

**Milestone ativo integrado:** M1 — backend de chat interno.
**Produção:** M1 Core implantado em 2026-10-08 UTC, commit
`89ca5d139ffd6b7e90bfe75a2c60db72621d695a`.
Duas migrations M1 aplicadas; quatro containers healthy; health/readiness
local/ingress/externo 200/200; smokes públicos REST/WSS, idempotência,
reconnect/replay, isolamento tenant e Origin/CSRF negativos passaram.
WEB_ORIGINS restaurado vazio; fixtures removidas. Backup/rollback/limites e
warnings MariaDB preexistentes em `docs/DEPLOYMENT.md`.
Frontend fora do escopo; milestone global M1 não encerrado.

## Documentação arquitetural

| Documento | Estado |
|---|---:|
| Arquitetura geral | ✅ |
| Modelo de domínio | ✅ |
| Features/Entitlements | ✅ |
| Realtime/Disponibilidade | ✅ |
| Integração Meta por Organization | ✅ |
| Diagnóstico/Capabilities | ✅ |
| Segurança/Privacidade/LGPD baseline | ✅ |
| API/Clientes/Android futuro | ✅ |
| Performance baseline | ✅ |
| Milestones | ✅ |

## M0 — Fundação

| Item | Estado | Evidência |
|---|---:|---|
| Estrutura de código do Core | ✅ | src/http, application, domain, infrastructure, realtime |
| Runtime/TypeScript | ✅ | Node 22; lint/typecheck/build em container |
| Prisma/MariaDB | ✅ | 2 migrations aplicadas; migrate status e diff sem divergência |
| Redis | ✅ | Readiness e rate limiting autenticado testados |
| User | ✅ | Identidade global; bootstrap/login sem role/Organization globais |
| Organization | ✅ | Bootstrap, listagem e troca de contexto via HTTP |
| Membership | ✅ | Vínculo ativo e permissions revalidados; testes negativos |
| Invitation — persistência M0 | ✅ | FK do autor/token único testados; aceite comercial pertence ao M2 |
| RBAC | ✅ | Role/Permission/RolePermission; organization.read; negação sem permission |
| Autenticação | ✅ | Login scrypt; anti-enumeração; User inativo negado |
| Sessão revogável | ✅ | Hash persistido; logout/relogin/expiração testados |
| Organization Context | ✅ | Seleção/troca/negativas; contexto não autoriza por si só |
| SecurityEvent | ✅ | Login sucesso/falha e revogação persistidos/testados |
| Rate limiting auth | ✅ | Redis; 11ª tentativa/minuto retorna 429 |
| CSRF/CORS/security headers | ✅ | Origin exato + token por sessão; testes de cookies/headers/negação |
| Error handling | ✅ | Erros de validação/infra/payload; nenhuma exceção interna na API |
| AuditEvent | ✅ | Bootstrap/contexto; verificação tenant-scoped |
| Segredos/criptografia base | ✅ | AES-256-GCM versionado; AAD tenant; testes de adulteração |
| Testes multi-tenant | ✅ | A/B, Membership/Organization inativas, permission e contexto forjado |
| /api/v1 | ✅ | 8 endpoints M0 + documento OpenAPI |
| OpenAPI inicial | ✅ | docs/openapi.json coincide com API em execução |
| Contrato realtime inicial | ✅ | Envelope reservado/documentado; nenhum evento ou WebSocket operacional |
| Estrutura API/Worker | ✅ | Mesma imagem; containers separados e saudáveis |

Validação: **25 testes passaram**, lint/typecheck/build passaram, smoke HTTP com
bootstrap administrativo passou, quatro containers saudáveis, health/readiness
HTTP 200, migrations consistentes e revisão de logs/segredos concluída.
Revalidação após rebase sobre `origin/main` (`d0aba4f`) manteve esses resultados,
usando a imagem reconstruída e os comandos documentados, sem conflitos.
Execução reproduzível: `docs/LOCAL_DEVELOPMENT.md`. Nenhuma pendência obrigatória
dentro do escopo M0 solicitado. O fluxo de convites condicionado a assentos,
Chat/WebSocket, catálogo/entitlements, Meta e mídia permanecem nos milestones
posteriores; o estado acima não declara essas funcionalidades implementadas.

## Deploy controlado M0 — Cloudflare

A fundação foi integrada pelo PR #2 com merge commit na main
`2c0982b66396753fcaa32dca9e8e6e308d434b85`; os três commits originais foram
preservados e a revalidação pós-merge passou com 25 testes.
Preparação de deploy em `chore/m0-cloudflare-deploy`; evidências e rollback em
`docs/DEPLOYMENT.md`.

| Item | Estado | Evidência |
|---|---:|---|
| Rede ingress da API | ✅ | API em backend + cloudflare_ingress preexistente |
| Banco/Redis/Worker privados | ✅ | Somente backend; nenhuma porta publicada |
| Configuração de produção local | ✅ | NODE_ENV production; WEB_ORIGINS vazio; cookie Secure/__Host- |
| Rate limiting por visitante | ✅ | IP fixo do connector; headers forjados de peers não confiáveis não burlam o limite |
| Validação da branch de deploy | ✅ | 29 testes e lint/typecheck/build passaram; smoke de autenticação anterior passou com origem autorizada |
| Health/readiness da rede cloudflared | ✅ | HTTP 200/200 no namespace do connector |
| Túnel existente preservado | ✅ | Nenhum restart/reconfiguração de cloudflared |
| Hostname/rota externa | ✅ | api.wapphub.com.br resolve e alcança health/readiness do Core |
| HTTPS health/readiness | ✅ | Certificado válido/TLS 1.3; HTTP 200/200 público |
| API pública M0 (health/readiness) | ✅ | Validada em 2026-10-08 UTC; sem cliente web autorizado |
| Sessão de cliente web pelo hostname público | ⬜ | Requer cliente aprovado; WEB_ORIGINS permanece vazio |

Nenhum requisito externo é marcado como concluído apenas pela resposta interna
200. Credenciais, chave de criptografia, migrations e dados existentes foram
preservados. Nenhuma funcionalidade de M1 foi iniciada.

## M1 — backend interno, escopo validado

| Item | Estado | Evidência |
|---|---:|---|
| Contacts/Conversations/Messages internas | ✅ | REST, FKs tenant-aware e testes positivos/negativos |
| Idempotência e recibos locais | ✅ | Retry/conflito/concorrência e estados SENT/DELIVERED/READ |
| Tags/Notes/archive | ✅ | Workflows, associações e auditoria |
| Assignment/transfer/supervision | ✅ | Permissions; FULL/LIMITED/NONE sem apagar histórico |
| Cursor pagination | ✅ | Inbox/histórico; assinatura e scope; sem OFFSET |
| WebSocket/event stream/reconnect | ✅ | Sessão/Origin/contexto, replay, revogação e fallback durável |
| Isolamento multi-tenant | ✅ | IDs estrangeiros negados em REST, persistência e realtime |
| OpenAPI | ✅ | Validação formal + identidade com schemas em modo produção |
| Roster mínimo para assignment/transfer | ✅ | Validado na branch `feat/m1-team-roster` (54 testes, OpenAPI, lint/typecheck/build); não integrado nem implantado |
| Validação backend | ✅ | 53 testes; lint/typecheck/build; HTTP/WS smoke; quatro migrations consistentes no teste |
| Ambiente separado | ✅ | Validação pré-deploy em projeto/DB/Redis/imagem/volumes próprios |
| Deploy backend em produção | ✅ | Duas migrations M1; REST/WSS/replay/tenancy; DEPLOYMENT.md |
| Frontend/UX/UI otimista/rotas SPA | ⬜ | Fora desta execução; milestone global M1 não encerrado |

Detalhes/limites: `M1_CHAT_INTERNAL.md`, `REALTIME_CONTRACT.md` e `M1_VALIDATION.md`.

## Branch de revisão `feat/m1-demo-provider`

Implementa o catálogo DEMO/META (META apenas em desenvolvimento), o port
`MessagingProvider`, adaptador determinístico Demo, serviço comum de ingestão,
estado tenant-scoped, provisionamento idempotente, mensagens INBOUND/OUTBOUND,
simulador autenticado e documentação/OpenAPI. Migrations aditivas
`20261008020000_demo_provider` e `20261008021000_demo_provider_rbac` aplicadas
exclusivamente ao banco isolado `wapphub_m1_test`; nenhuma migration ou dado
de produção foi alterado.

O branch ainda não está integrado nem publicado. Validação atual: **56 testes**
no banco isolado, lint/typecheck/build passaram, OpenAPI gerado e validado. Não
houve deploy, uso de serviços externos ou alteração de produção. Nenhum
adaptador Meta foi implementado.
Sem pendência funcional conhecida no escopo backend validado. Nenhuma entrega de
Meta, M2+, mídia, billing ou Android foi antecipada. M1 Core promovido à produção; evidências atuais em `DEPLOYMENT.md`.

## Funcionalidades posteriores

| Domínio | Estado |
|---|---:|
| Chat operacional realtime | 🟡 Backend M1 validado; frontend fora do escopo |
| Entitlements | ⬜ |
| WappHub Admin | ⬜ |
| Minha Conta | ⬜ |
| Meta por Organization | ⬜ |
| Diagnóstico de integração | ⬜ |
| Imagem/áudio | ⬜ |
| Performance 100 agentes | ⬜ |
| MVP comercial | ⬜ |
| Android nativo | ⛔ Pós-MVP |

## Regra de atualização

Não marcar como ✅ apenas porque:
- schema foi criado;
- tela foi desenhada;
- endpoint existe sem regra completa;
- código foi gerado mas não validado.

✅ significa implementado, testado conforme critério do milestone e integrado ao fluxo esperado.
