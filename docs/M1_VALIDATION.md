# Validação M1 — backend interno

## Reconciliação atual — 2026-10-08

Core publicado 72d05aa, Chat publicado 3e23452. Ledger de produção possui seis
migrations concluídas, com checksums Git iguais; OpenAPI público igual ao local.
Reexecutados lint/typecheck, **56 testes**, build e OpenAPI no container API do
projeto isolado wapphub-m1-test (código fingerprint igual à imagem publicada),
NODE_ENV=test, banco wapphub_m1_test e Redis isolado. Não houve migrations,
seeds, alteração de serviços ou dados de produção. Chat: 86 testes/checks aprovados.
Contraprovas sintéticas adicionais revelaram prévia sem autorização/histórico
(A1) e checkpoint antes de aplicação REST no frontend (A2). Portanto suíte verde
não equivale a encerramento M1. Detalhes: `M1_ARCHITECTURE_ACCEPTANCE_20261008.md`.

Comando desta revalidação (somente container de teste existente):

```sh
docker exec wapphub-m1-test-wapphub-core-api-1 sh -c 'npm run lint && npm run typecheck && npm test && npm run build && npm run openapi:validate'
```

Confirmar antes código e NODE_ENV/database de teste; não substituir por container
de produção. Os comandos históricos abaixo incluem setup/migrations apenas em
banco isolado e não foram executados nesta auditoria.

## Registro histórico da validação inicial M1

O restante descreve a primeira execução isolada (53 testes, antes de roster/Demo);
as afirmações de produção M0/não publicada e quatro migrations são desse momento,
superadas pelos deploys em DEPLOYMENT e pelo inventário atual.

Escopo: backend/Core somente; frontend, Meta e milestones M2+ excluídos.
Produção M0 não é alvo de migrations, rebuild/restart ou testes com fixtures.
Base revisada: b790b6ce7ee427f931f84c5d0ac0ef1dd6d53fc5.
Branch: feat/m1-chat-internal, sem PR/merge automático.

## Ambiente isolado e comandos

Projeto wapphub-m1-test, banco wapphub_m1_test, Redis separado, imagem
wapphub-core:m1-test, volume test-db e API somente 127.0.0.1:3101. Nenhuma
rede de produção/ingress é utilizada. Segredos próprios em .env.m1-test ignorado,
permissão 600; setup idempotente via scripts/m1-test.sh init.

```sh
scripts/m1-test.sh init
scripts/m1-test.sh build wapphub-core-api
scripts/m1-test.sh up -d --wait wapphub-db wapphub-redis
scripts/m1-test.sh run --rm --no-deps wapphub-core-api npm run db:migrate
scripts/m1-test.sh up -d --wait
scripts/m1-test.sh run --rm wapphub-core-api sh -c 'npm run lint && npm run typecheck && npm test && npm run build'
scripts/m1-test.sh run --rm wapphub-core-api npx prisma validate
scripts/m1-test.sh run --rm wapphub-core-api npx prisma migrate status
scripts/m1-test.sh run --rm wapphub-core-api npx prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --exit-code
scripts/m1-test.sh run --rm wapphub-core-api npm run openapi:validate
scripts/m1-test.sh run --rm wapphub-core-api node dist/scripts/smoke.js
scripts/m1-test.sh run --rm wapphub-core-api node dist/scripts/smoke-chat.js
scripts/m1-test.sh ps
curl --fail http://127.0.0.1:3101/api/v1/health
curl --fail http://127.0.0.1:3101/api/v1/health/ready
curl --fail https://api.wapphub.com.br/api/v1/health
curl --fail https://api.wapphub.com.br/api/v1/health/ready
```

As duas migrations M0 são preservadas. Novas migrations:
20261008013000_m1_internal_chat (oito tabelas/índices/FKs) e
20261008014000_m1_transfer_audience (destinatário da invalidação mínima).
A segunda é aditiva porque a primeira já havia sido aplicada no ambiente de
teste; nenhum SQL já aplicado foi reescrito. Produção não recebeu nenhuma delas.

## Cobertura

Os 29 testes existentes são preservados; a asserção OpenAPI agora exige a lista
exata de rotas da fundação mais extensões M1, sem APIs de milestones futuros.
24 testes adicionais cobrem Contacts, Conversations, filtros, Messages/recibos,
idempotência, cursores, archive/unarchive, assignment e destinatários inativos,
FULL/LIMITED/NONE em REST/replay, Tags, Notes, RBAC, supervision/auditoria,
validação de payload/CSRF e IDs de tenant estranho, inclusive constraints no banco.

WebSocket usa conexão TCP real Fastify/ws. Testes positivos/negativos cobrem
upgrade, Origin, autorização, tenant, contexto, User/Organization/Membership
inativos, logout/revogação, remoção de permission, comandos rejeitados,
reconnect/replay, transferência live e catch-up após notificação perdida.
Smoke separado usa API/container real, bootstrap HTTP, envio idempotente,
WebSocket e reconnect, sem fixtures de produção.

Concorrência básica: oito sockets (quatro por tenant), oito retries simultâneos
da mesma chave e doze envios distintos concorrentes entre tenants. Verifica
unicidade de Message/evento, recebimento e ausência de mistura de tenant.
Isso NÃO comprova benchmark M5 de 100 agentes, SLA ou métricas de carga final.

## Resultados finais — 2026-10-08 UTC

A imagem final foi reconstruída e validada sem montar source/testes do host:
53 testes passaram (29 existentes + 24 M1), zero falhas, skips ou cancelamentos.
Lint/typecheck/build passaram. Prisma validate passou; quatro migrations
aplicadas no banco de teste, checksums correspondentes aos SQLs versionados,
nenhuma pendência nem diferença banco/schema. As duas migrations M0 e seus
checksums de produção foram preservados; produção permanece com somente duas.

OpenAPI passou no Swagger Parser e corresponde exatamente aos schemas em modo
produção. Smoke HTTP M0/bootstrap e smoke HTTP/WebSocket M1 passaram contra a
API real do projeto isolado, incluindo idempotência/live/reconnect. Health e
readiness do teste retornaram 200; seus quatro containers permaneceram healthy.

Smoke básico de concorrência: oito WebSockets e vinte envios concorrentes
(oito retries e doze únicos), fase medida em 860 ms nesta execução. Sem mistura
de tenant ou duplicação indevida. Esse tempo não é p95/benchmark M5 e não
comprova a meta de cem agentes.

Produção permaneceu com os mesmos IDs/imagens/StartedAt/mounts registrados antes
da execução, os quatro containers healthy e HTTPS health/readiness HTTP 200.
MariaDB/Redis de produção seguem somente backend, sem portas publicadas; nenhum
volume foi removido. API M1 não foi conectada à ingress nem publicada no hostname
oficial. Nenhum segredo local/chave privada foi encontrado nos arquivos revisados
ou logs API/Worker. NODE_ENV/WEB_ORIGINS/credenciais de produção foram preservados.

## Limites e pendências

Frontend/UX/rotas SPA/UI otimista do milestone global M1 permanecem fora deste
pedido; não marcar o milestone completo como entregue por validar só o backend.
Sem bloqueio funcional conhecido no escopo backend após validação final.
Retenção/compactação de eventos e benchmark M5 não foram implementados.
Não há provider, mídia, entitlements comerciais, Android ou integração Meta.
Estado de mensagem e política de notas/transferência estão em M1_CHAT_INTERNAL.md.
