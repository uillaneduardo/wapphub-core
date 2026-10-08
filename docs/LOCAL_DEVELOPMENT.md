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
5. Defina `WEB_ORIGINS` com origens exatas separadas por vírgulas, sem barra final.
6. Execute `scripts/local.sh up`.

O script constrói a imagem, aguarda banco/Redis, executa `prisma migrate deploy`
e sobe API/Worker. `scripts/local.sh deploy` faz o mesmo fluxo de rebuild.
`stop` preserva dados; `status` mostra containers; `logs [serviço]` mostra logs.
Nenhum script remove volumes. A API fica em `127.0.0.1:3000`; banco e Redis não
publicam portas e usam rede Docker interna. A API também participa da rede
HTTP, necessária para publicação loopback no Docker 29; banco/Redis permanecem
exclusivamente na rede interna. Redis mantém apenas limites de
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
antes de usar rate limiting por IP por trás dele. CORS não aceita wildcard.
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
