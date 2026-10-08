# Evidências de validação M0

Validação realizada em 2026-10-07 (America/Recife), branch
`feat/m0-foundation`, no homelab Linux com Docker 29.7.2 e Compose 5.5.0.
Escopo: prompt oficial recuperado do commit `d0aba4f` e
[issue #1](https://github.com/uillaneduardo/wapphub-core/issues/1).

## Resultados

| Verificação | Resultado |
|---|---|
| Imagem Docker: Prisma generate + TypeScript build | Passou |
| Lint | Passou |
| Typecheck | Passou |
| Testes automatizados com MariaDB/Redis reais | 25 passaram; 0 falharam/ignorados |
| Build após testes | Passou |
| Migrate deploy | Duas migrations aplicadas |
| Migrate status | Schema atualizado, nenhuma migration pendente |
| Diff banco vs Prisma schema | No difference detected |
| GET /api/v1/health via loopback | HTTP 200, status ok |
| GET /api/v1/health/ready via loopback | HTTP 200, status ready |
| Smoke HTTP + bootstrap administrativo | Passou |
| OpenAPI versionado vs documento da API em execução | Iguais |
| Containers API/Worker/MariaDB/Redis | Todos healthy |
| npm audit | 0 vulnerabilidades |
| Logs API/Worker | Sem credenciais/segredos locais ou exceções internas expostas |
| Arquivos versionáveis | Nenhum segredo local encontrado; .env ignorado |

As verificações iniciais de lint/typecheck/test/build foram executadas via Compose,
com a suíte final montada em `/app/tests` antes da atualização da imagem.
`scripts/local.sh validate` reproduz os mesmos quatro comandos após rebuild.

## Testes de segurança e isolamento

A suíte `tests/foundation.test.ts` valida login, hashes persistidos, flags dos
cookies de produção, anti-enumeração, falta/falsificação de sessão, expirações,
logout/relogin, Membership/Organization/User inativos, negação por permission,
CSRF com Origin/token inválidos ou token de outra sessão, CORS/headers,
rate limiting Redis, auditoria tenant-scoped e AAD tenant na criptografia.

As negativas A/B verificam listagem, seleção e bootstrap: A não seleciona B;
identificadores arbitrários em query/header não alteram o contexto autorizado;
contexto de B adulterado no banco permanece insuficiente sem Membership ativa.
Persistência de Invitation valida estado inicial, hash único e FK do autor.
Falhas controladas comprovam respostas/logs sanitizados e readiness degradada.
Payload excessivo, JSON malformado e content type incompatível retornam erros
seguros, sem incluir o conteúdo recebido.

O smoke usa HTTP real entre containers e provisionamento pelo script
administrativo: login → /me → organizações → seleção → bootstrap → logout → 401.
As fixtures são removidas ao fim; nenhuma senha/conta padrão permanece.

## Migrations

- `202610070001_foundation`: identidade global, Organization, Membership,
  Invitation, RBAC, Session, AuditEvent e SecurityEvent; índices/uniques/FKs.
- `202610070002_foundation_relations`: FK do autor do convite e do contexto de
  Organization na sessão. A migration inicial aplicada foi preservada.

## Ajustes e limites

Não houve alteração da stack nem das decisões arquiteturais aprovadas.
O override `deepmerge-ts@8` corrige vulnerabilidade transitiva da CLI Prisma 6;
generate, migrate e diff passaram com essa resolução. Neste ambiente Docker 29,
a API precisa também da rede HTTP para publicação em 127.0.0.1. Banco e Redis
ficam exclusivamente na rede interna, sem portas publicadas.

A validação é local M0. Não declara teste de carga de 100 agentes, deploy HTTPS,
backup/restore, recuperação de senha/MFA, convites comerciais, WebSocket/Chat,
Meta, mídia ou entitlements completos. Nenhuma dessas funcionalidades foi
antecipada. O Worker está pronto para execução separada e não processa jobs no M0.

## Revalidação após sincronização com origin/main

Em 2026-10-08T00:13:59Z (2026-10-07 em America/Recife), a branch
`feat/m0-foundation` foi revalidada após rebase sobre `origin/main` no commit
`d0aba4f`. Os dois commits remotos de documentação/prompts foram incorporados
sem conflitos. Todos os arquivos commitados do M0 foram preservados byte a byte
durante o rebase; a branch local `main` e o `.env` real não foram alterados.

Comandos e resultados efetivamente executados:

```sh
scripts/local.sh deploy
scripts/local.sh validate
docker compose run --rm wapphub-core-api node dist/scripts/smoke.js
docker compose run --rm wapphub-core-api npx prisma migrate status
docker compose run --rm wapphub-core-api npx prisma migrate diff \
  --from-schema-datasource prisma/schema.prisma \
  --to-schema-datamodel prisma/schema.prisma --exit-code
curl --fail http://127.0.0.1:3000/api/v1/health
curl --fail http://127.0.0.1:3000/api/v1/health/ready
docker compose exec -T wapphub-redis redis-cli ping
docker compose ps
npm audit
```

A imagem foi reconstruída do código rebased; `validate` executou lint,
typecheck, **25 testes** (nenhuma falha/omissão) e build diretamente na imagem,
sem montar código ou testes do host. O smoke HTTP passou. MariaDB respondeu
às queries de validação; Redis retornou `PONG`; ambas as migrations possuem
checksums iguais aos arquivos versionados, estão finalizadas e não foram
revertidas. Não há migrations pendentes nem diferença banco/schema.

Health/readiness retornaram HTTP 200; API, Worker, MariaDB e Redis permaneceram
`healthy`. O OpenAPI versionado coincide com a API em execução. A revisão de
arquivos commitados e logs não encontrou segredos locais, chaves privadas ou
credenciais; `.env.example` possui somente placeholders. `.gitignore` e
`.dockerignore` também protegem chaves/certificados e arquivos de credenciais.
O `.env` real foi preservado e não foi incluído na imagem ou nos commits.

Os logs do MariaDB registram avisos de `io_uring` indisponível no host e
`Aborted connection` ao encerrar conexões. Esses avisos foram registrados na
revisão; as verificações de conectividade, migrations, transações e testes
passaram. Não foram observados erros ou detalhes sensíveis nos logs da
API/Worker. `npm audit` reportou zero vulnerabilidades.

## Merge do M0 e preparação do primeiro deploy

PR #2 integrado com merge commit, mantendo os três commits originais do M0.
Main: `2c0982b66396753fcaa32dca9e8e6e308d434b85`. A árvore da main após merge
é idêntica à feature validada. Working tree da main permaneceu limpo e as
migrations aplicadas mantiveram seus checksums.

A revalidação pós-merge repetiu lint/typecheck/25 testes/build, migrations status,
smoke HTTP, health/readiness e containers healthy. Nenhuma divergência foi
observada antes ou após o merge.

A preparação Cloudflare foi isolada em `chore/m0-cloudflare-deploy`, com 28
testes passando, lint/typecheck/build e smoke HTTP em modo de produção.
Health/readiness internos também retornaram 200 a partir da rede do cloudflared.
O deploy externo permanece pendente: os dois endpoints HTTPS falham no handshake
TLS. O túnel não foi alterado. Rede, confiança explícita de IP, configurações,
pendências manuais e rollback estão em `DEPLOYMENT.md`.

## Hostname oficial e origens de clientes web

Em 2026-10-08 UTC (2026-10-07 em America/Recife), a imagem da branch de deploy
foi reconstruída e `scripts/local.sh validate` passou: lint, typecheck, 29 testes
sem falhas/omissões e build. WEB_ORIGINS local está vazio, sem autorizar a URL
da API ou antecipar o futuro cliente web. A suíte usa origem própria e testa
negação da URL da API e de comandos com lista vazia.

https://api.wapphub.com.br é o hostname oficial. DNS local e resolvedores
públicos Cloudflare/Google passaram. HTTPS validou cadeia e hostname com TLS
1.3; health e readiness públicos retornaram HTTP 200. Os dois endpoints também
retornaram 200 localmente e no namespace do cloudflared. Quatro containers
healthy, MariaDB/Redis/Worker somente em backend e sem portas publicadas.
A falha TLS do registro anterior ocorreu antes da troca de hostname. Não houve
alteração de migrations, credenciais ou configuração externa do túnel. O fluxo
público de sessão aguarda um cliente web aprovado; M1 não foi iniciado.
