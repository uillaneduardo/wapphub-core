# Execução local — M0

## Ambiente reproduzível

Docker Engine e Docker Compose são os únicos pré-requisitos no host. Node 22,
Fastify 5, Prisma 6, MariaDB 11.4 e Redis 7.4 são executados em containers.
Prisma 6 foi escolhido como versão estável compatível com o datasource MySQL;
`deepmerge-ts` tem override para 8, validado com generate/migrate, para eliminar
uma vulnerabilidade transitiva da CLI. O lockfile fixa as dependências Node.

1. Copie `.env.example` para `.env` e restrinja suas permissões (`chmod 600 .env`).
2. Gere senhas distintas para `DB_PASSWORD`/`DB_ROOT_PASSWORD` com `openssl rand -hex 24`.
3. Atualize a senha em `DATABASE_URL`, mantendo host `wapphub-db`.
4. Gere `ENCRYPTION_KEY` com `openssl rand -hex 32`.
5. Defina `WEB_ORIGINS` com origens de clientes web autorizados, separadas por
   vírgulas, sem barra final. A URL da API não autoriza CORS por si só. Uma lista
   vazia bloqueia comandos web; localhost:5173 no exemplo é um cliente de desenvolvimento.
6. Execute `scripts/local.sh up`.

O script constrói a imagem, aguarda banco/Redis, executa `prisma migrate deploy`
e sobe API/Worker. `scripts/local.sh deploy` faz o mesmo fluxo de rebuild.
`stop` preserva dados; `status` mostra containers; `logs [serviço]` mostra logs.
Nenhum script remove volumes. A API fica em `127.0.0.1:3000`; banco e Redis não
publicam portas e usam rede Docker interna. Neste perfil de homelab, a API
também participa da rede externa preexistente `cloudflare_ingress`; confira sua
existência com `docker network inspect cloudflare_ingress` antes de subir.
Banco/Redis/Worker permanecem exclusivamente na rede interna. A preparação de
produção e o procedimento de rollback estão em `DEPLOYMENT.md`. Redis mantém apenas limites de
abuso, nunca dados de domínio. Reiniciar Redis reinicia as janelas de limite.

O `.env` local é ignorado pelo Git e excluído da imagem. Não copie segredos para
arquivos versionados nem passe senhas como argumentos da CLI.

## Validação

```sh
scripts/local.sh validate
curl --fail http://127.0.0.1:3000/api/v1/health
curl --fail http://127.0.0.1:3000/api/v1/health/ready
docker compose run --rm wapphub-core-api npx prisma migrate status
docker compose run --rm wapphub-core-api node dist/scripts/smoke.js
```

Os testes usam MariaDB e Redis reais da rede Compose, criam fixtures com IDs
únicos e removem apenas essas fixtures. Não execute a suíte em banco de produção.
A suíte usa uma origem web própria de teste, independente de WEB_ORIGINS do
deploy. O smoke de autenticação requer uma origem de cliente já autorizada;
com WEB_ORIGINS vazio, use health/readiness e a suíte para validação.
Os eventos anônimos LOGIN_FAILED ficam registrados sem e-mail/IP/segredos.
O smoke provisiona uma fixture administrativa, percorre o fluxo HTTP real e
remove apenas essa identidade/Organization. Mantém as definições padrão de
Role/Permission do bootstrap.

Para atualizar o contrato oficial:

```sh
docker compose run --rm -v "$PWD/docs:/app/docs" wapphub-core-api npm run openapi
```

## Bootstrap explícito

Não há usuário/senha padrão nem seed automático. O script administrativo cria
uma identidade nova, Organization, Membership OWNER, permission
`organization.read`, perfis OWNER/SUPERVISOR/AGENT e AuditEvent. Não sobrescreve
identidades existentes. Convites têm schema no M0; aceitação/assentos pertencem
à evolução posterior.

Defina no shell `BOOTSTRAP_EMAIL`, `BOOTSTRAP_PASSWORD` (mínimo 12 caracteres),
`BOOTSTRAP_ORGANIZATION` e opcionalmente `BOOTSTRAP_NAME`, sem gravar senha no
histórico. Encaminhe essas variáveis por nome:

```sh
docker compose run --rm \
  -e BOOTSTRAP_EMAIL -e BOOTSTRAP_PASSWORD \
  -e BOOTSTRAP_ORGANIZATION -e BOOTSTRAP_NAME \
  wapphub-core-api npm run bootstrap
unset BOOTSTRAP_PASSWORD
```

## Uso da sessão web

- Login exige `Origin` presente na lista `WEB_ORIGINS`, inclusive em clientes CLI.
- Cookie de sessão HttpOnly/SameSite=Strict; Secure e nome `__Host-wapphub_session`
  em produção. HTTPS é responsabilidade do proxy TLS externo.
- Login retorna `csrfToken` e grava cookie legível `wapphub_csrf` para restauração
  do header após reload. `GET /me` também restitui esse token quando o cookie
  corresponde à sessão, permitindo clientes web em outra origem. O banco
  armazena só hashes dos tokens.
- Operações POST autenticadas exigem `Origin` permitido e `X-CSRF-Token` válido,
  vinculado à sessão. Login exige Origin/JSON e tem limite Redis de 10/min por IP.
- `GET /me/organizations` lista Memberships ativas em Organizations ativas.
- `POST /session/organization` seleciona contexto após Membership/permission.
- `GET /app/bootstrap` retorna User, Organization, Membership e permissions.
  Entitlements, canais e preferências não são simulados no M0.
- Cada leitura protegida revalida User, sessão e Membership selecionada.
- Logout revoga a sessão no banco e limpa cookies. Continua disponível quando a
  Membership selecionada é revogada, pois encerra apenas a própria sessão.
- Nova autenticação substitui/revoga a sessão do cookie anterior.
- Expiração absoluta e por inatividade são configuráveis; sessões expiradas não
  são reativadas. Nenhuma sessão/cache de autorização reside apenas na API.

A API não confia em proxy headers (`trustProxy=false`). Se houver proxy reverso,
a identificação de IP deve ser configurada para proxies explicitamente confiáveis
antes de usar rate limiting por IP por trás dele. O perfil Cloudflare conserva
`trustProxy=false` e limita a leitura de `CF-Connecting-IP` no rate limiting aos
IPs exatos configurados em `CLOUDFLARED_TRUSTED_IPS`; outros headers de proxy
continuam ignorados. Essa configuração é opcional e vazia por padrão. CORS não aceita wildcard.
Em produção `WEB_ORIGINS` exige HTTPS. Não há fluxo nativo Android implementado.

## Processos e arquitetura

`src/http` contém contratos/controllers; `src/application` contém login,
revogação e autorização por Membership/permission; `src/domain` contém erros;
`src/infrastructure` contém configuração, conexões e criptografia;
`src/realtime` reserva o envelope para M1.

API e Worker compartilham imagem. Worker M0 mantém conexões e encerramento
controlado; não executa jobs, polling de domínio ou integração Meta.
Healthchecks verificam disponibilidade do banco e Redis. AuditEvent registra
seleção de contexto/bootstrap; SecurityEvent registra sucesso/falha de login e
revogação. O tratamento HTTP retorna códigos WappHub e requestId, nunca erros
Prisma, stack traces ou valores enviados. Logs não registram corpos e removem
querystrings, cookies, headers sensíveis e detalhes de exceções.

Senhas usam scrypt versionado (N=65536, r=8, p=1, chave 64 bytes) com salt
aleatório de 16 bytes. A base AES-256-GCM inclui versão
de chave e AAD com escopo tenant; rotação admite um mapa de versões na leitura.
Não há credencial Meta ou endpoint de armazenamento de segredos no M0.

OpenAPI oficial: `docs/openapi.json`, servido em `/api/v1/openapi.json`.
Contrato reservado de realtime: `docs/REALTIME_CONTRACT.md`.

## Desenvolvimento M1 sem tocar na produção

Use exclusivamente `scripts/m1-test.sh`, que fixa arquivo Compose, projeto e
`.env.m1-test`. Não use local.sh/deploy/validate ou o Compose de produção para
esses testes/migrations. `compose.test.yml` usa projeto wapphub-m1-test, imagem
wapphub-core:m1-test, banco wapphub_m1_test, Redis separado, volume test-db
e porta loopback 3101. A API não participa de cloudflare_ingress.

Execute `scripts/m1-test.sh init` para criar `.env.m1-test` local ignorado,
protegido por permissão 600 e com credenciais próprias; configuração existente
é preservada. Alternativamente crie o arquivo manualmente com credenciais
novas próprias. Configure NODE_ENV=test, PORT=3000,
WEB_ORIGINS=https://web-client.example.test,
DATABASE_URL=mysql://wapphub_test:<TEST_PASSWORD>@wapphub-db:3306/wapphub_m1_test,
DB_PASSWORD/DB_ROOT_PASSWORD independentes, REDIS_URL=redis://wapphub-redis:6379
e ENCRYPTION_KEY aleatória de 64 caracteres hexadecimais. Não copie .env de
produção nem reutilize credenciais/volumes. Testes M1 e smoke-chat recusam
NODE_ENV diferente de test ou schema sem sufixo _test.

```sh
scripts/m1-test.sh init
scripts/m1-test.sh up -d --wait wapphub-db wapphub-redis
scripts/m1-test.sh build wapphub-core-api
scripts/m1-test.sh run --rm --no-deps wapphub-core-api npm run db:migrate
scripts/m1-test.sh up -d --wait
scripts/m1-test.sh run --rm wapphub-core-api sh -c 'npm run lint && npm run typecheck && npm test && npm run build'
scripts/m1-test.sh run --rm wapphub-core-api npx prisma validate
scripts/m1-test.sh run --rm wapphub-core-api npx prisma migrate status
scripts/m1-test.sh run --rm wapphub-core-api npx prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --exit-code
scripts/m1-test.sh run --rm -e NODE_ENV=production -v "$PWD/docs:/app/docs" wapphub-core-api npm run openapi
# Depois de atualizar a imagem para incluir o OpenAPI gerado:
scripts/m1-test.sh run --rm wapphub-core-api npm run openapi:validate
scripts/m1-test.sh run --rm wapphub-core-api node dist/scripts/smoke.js
scripts/m1-test.sh run --rm wapphub-core-api node dist/scripts/smoke-chat.js
curl --fail http://127.0.0.1:3101/api/v1/health
curl --fail http://127.0.0.1:3101/api/v1/health/ready
```

A suíte conserva os 29 testes da fundação e adiciona fluxos/negativas M1.
O teste de contrato M0 passa a exigir todas as rotas originais e a lista exata
de extensões M1, sem liberar APIs de milestones posteriores. Não usar testes
contra dados de clientes. Para parar apenas o teste: `scripts/m1-test.sh stop`;
não remover volumes. Evidências e limites em M1_VALIDATION.md.
