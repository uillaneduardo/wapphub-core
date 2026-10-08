# Deploy do Core — homelab e Cloudflare Tunnel

Estado vigente: M1 Core implantado em 2026-10-08 UTC; evidências abaixo.
As seções M0 e desenvolvimento isolado registram o histórico anterior.

## Estado validado

O M0 foi integrado pelo [PR #2](https://github.com/uillaneduardo/wapphub-core/pull/2)
com merge commit, preservando os três commits originais.
Main validada: `2c0982b66396753fcaa32dca9e8e6e308d434b85`.
Após o merge: 25 testes, lint, typecheck, build, smoke HTTP, migrations e
health/readiness passaram. Nenhum volume ou dado existente foi removido.

A preparação do deploy reside em `chore/m0-cloudflare-deploy`. Após a troca
para o hostname oficial https://api.wapphub.com.br, 29 testes passaram,
sem falhas/omissões, assim como lint, typecheck e build via
`scripts/local.sh validate`, na imagem reconstruída por `scripts/local.sh deploy`.

Validação em 2026-10-08 UTC (2026-10-07 em America/Recife):

- DNS local, Cloudflare e Google resolveram o hostname oficial.
- HTTPS válido, com verificação de cadeia e hostname habilitada: TLS 1.3,
  certificado Google Trust Services WE1 cobrindo `*.wapphub.com.br`, válido
  até 2026-12-31. Nenhum bypass de TLS foi usado.
- Health e readiness públicos retornaram HTTP 200; os mesmos endpoints locais
  e pela rede do cloudflared retornaram 200/status ok e 200/status ready.
- API, Worker, MariaDB e Redis permaneceram healthy. Banco/Redis/Worker
  continuam somente na backend, sem portas publicadas no host.
- Nenhuma origem web está autorizada: WEB_ORIGINS vazio, sem frontend M0.
  A suíte usa sua própria origem de cliente e comprova que a URL da API não
  autoriza comandos web. O fluxo público de sessão não foi exercitado nesta
  configuração fechada; os testes de sessão/CSRF continuam passando.

Uma consulta DNS inicial falhou com `[Errno -2] Name or service not known`;
a nova consulta e ambos os requests HTTPS seguintes passaram. A rota pública
já estava disponível; não foi criada nem modificada por este trabalho. O Core
não reconfigura/recria o túnel existente nem modifica outros serviços do homelab.

## Validação final com múltiplos clientes HTTP

Após a ativação pelo operador da regra Skip de Browser Integrity Check restrita
ao hostname `api.wapphub.com.br`, a revalidação de 2026-10-08 UTC confirmou:

| Cliente | Health | Readiness | Corpo | cf-ray |
|---|---|---|---|---|
| curl padrão | 200 | 200 | status ok / ready | presente |
| curl com WappHub-HealthCheck/1.0 | 200 | 200 | status ok / ready | presente |
| Python urllib padrão | 200 | 200 | status ok / ready | presente |
| Python urllib com WappHub-HealthCheck/1.0 | 200 | 200 | status ok / ready | presente |

Todas as respostas correspondem ao WappHub Core. O bloqueio anterior
HTTP 403 / error code 1010 não ocorreu em nenhum desses oito requests.
TLS 1.3 validou cadeia e hostname sem bypass. Health/readiness locais e pela
rede do connector retornaram 200/200, com os quatro containers healthy e
MariaDB/Redis privados. Cookies e informações sensíveis não foram registrados.
A regra externa foi informada pelo operador; este trabalho não alterou a
configuração Cloudflare. WEB_ORIGINS continua vazio, sem cliente web autorizado.

## Rede e origem

| Item | Configuração |
|---|---|
| Hostname oficial | api.wapphub.com.br |
| Service/origin | http://wapphub-core-api:3000 |
| Porta interna | 3000 HTTP |
| Rede externa existente | cloudflare_ingress |
| Connector existente | cloudflare-cloudflared-1 |
| IP fixo observado do connector | 172.19.0.250 |
| API | backend + cloudflare_ingress |
| MariaDB / Redis / Worker | somente backend, interna |
| Acesso local da API | 127.0.0.1:3000 |
| Health | /api/v1/health |
| Readiness | /api/v1/health/ready |

O Compose reutiliza `cloudflare_ingress` como rede externa. A rede precisa
existir antes de subir esse perfil; não crie/recrie o túnel nem altere outros
serviços do homelab. MariaDB e Redis não publicam portas no host nem participam
da rede do tunnel. O Worker também não possui exposição pública.

## Configuração de produção

No `.env` local, ignorado pelo Git e com permissão 600:

```dotenv
NODE_ENV=production
WEB_ORIGINS=
CLOUDFLARED_TRUSTED_IPS=172.19.0.250
PORT=3000
API_PORT=3000
```

WEB_ORIGINS representa somente origens de clientes web explicitamente
autorizados, não a URL pública da API. Neste M0 sem frontend autorizado, a lista
vazia bloqueia comandos web e não envia Access-Control-Allow-Origin. Health e
readiness continuam disponíveis. O futuro https://chat.wapphub.com.br é um
exemplo de cliente possível, não uma autorização automática: só inclua sua
origem quando esse cliente for aprovado e necessário.

Cada cliente autorizado deve usar origem HTTPS exata, sem wildcard, com revisão
de SameSite/CORS/CSRF. Comandos POST exigem Origin permitido e, quando
autenticados, o token CSRF vinculado à sessão. O smoke completo de autenticação
requer uma origem de cliente autorizada; com lista vazia, valide health/readiness
e use a suíte automatizada, que configura sua própria origem web de teste.

Cookie de sessão: `__Host-wapphub_session`, Secure, HttpOnly, SameSite=Strict,
Path=/ e sem Domain. O contrato OpenAPI dessa branch registra esse cookie de
produção. TLS público termina na Cloudflare; o trecho connector → API usa
HTTP na rede Docker. Nenhum controle de cookie depende de X-Forwarded-Proto.
Senhas do banco e chave de criptografia existentes foram preservadas.

### IP do visitante e confiança no proxy

Fastify mantém `trustProxy=false`. X-Forwarded-For/Proto/Host não ganham confiança
ampla. Para o rate limiting do login, o Core aceita CF-Connecting-IP somente
quando o endereço real do socket corresponde a um IP explícito de
CLOUDFLARED_TRUSTED_IPS e o header contém um IP válido. Headers inválidos,
conexões diretas e outros containers mantêm o limite pelo IP do peer.
CIDRs, wildcards e nomes de host são rejeitados na configuração.

O header serve somente para rate limiting, nunca para autenticação/tenancy.
O formato do header segue a [referência oficial Cloudflare](https://developers.cloudflare.com/fundamentals/reference/http-headers/).
Antes de atualizar, confira o IP fixo do connector sem exibir tokens:

```sh
docker inspect --format '{{with index .NetworkSettings.Networks "cloudflare_ingress"}}{{.IPAddress}}{{end}}' cloudflare-cloudflared-1
```

Se o IP mudar, interrompa o deploy e revise a lista explícita. Não amplie a
confiança para todo o subnet. Na Cloudflare, a rota deve encaminhar diretamente
para a origem indicada e preservar CF-Connecting-IP; Workers/transforms que
alterem a identidade do visitante exigem revisão específica.

## Configuração do hostname oficial na Cloudflare

No túnel existente utilizado por `cloudflare-cloudflared-1`, confirmar/criar a
rota de aplicação pública com:

- hostname: **api.wapphub.com.br**;
- tipo do serviço: **HTTP**;
- service/origin: **http://wapphub-core-api:3000**;
- porta: **3000**;
- rede Docker: **cloudflare_ingress**;
- serviço Compose: **wapphub-core-api**.

Confirmar um certificado edge ativo que cubra o hostname exato. O endereço
oficial usa um único nível de subdomínio. Confira a cobertura conforme as
[limitações de Universal SSL](https://developers.cloudflare.com/ssl/edge-certificates/universal-ssl/limitations/).
Não desative validação TLS, não troque o domínio solicitado e não substitua o
túnel para contornar a falha. Somente essa rota da API deve ser publicada.

Depois da configuração manual:

```sh
curl --fail https://api.wapphub.com.br/api/v1/health
curl --fail https://api.wapphub.com.br/api/v1/health/ready
```

Ambos devem retornar HTTP 200 com os contratos do Core. Quando houver um cliente web aprovado, validar também o fluxo HTTPS de
login/CSRF/logout e o encaminhamento do IP de visitante. A validação pública
atual cobre health/readiness; não declara um cliente web operacional.

## Verificação interna

Validação realizada no mesmo namespace de rede do cloudflared, sem alterá-lo:

```sh
docker run --rm --network container:cloudflare-cloudflared-1 \
  --entrypoint node wapphub-core:local --input-type=module -e \
  'for (const path of ["health","health/ready"]) { const r=await fetch("http://wapphub-core-api:3000/api/v1/"+path); console.log(path,r.status,await r.text()); if (!r.ok) process.exitCode=1; }'
```

Resultados: health 200/status ok; readiness 200/status ready. Os quatro
containers permaneceram healthy; o connector manteve sua identidade,
redes e data de início originais. Banco, Redis e migrations não foram alterados.

## Atualização e rollback

Atualize somente uma referência revisada do Core, com working tree limpo.
Enquanto a branch de deploy não for integrada, a main contém a fundação local,
mas não a preparação Cloudflare dessa branch.

```sh
git fetch origin
# Confira a referência aprovada e use somente atualização fast-forward.
scripts/local.sh deploy
scripts/local.sh validate
docker compose run --rm wapphub-core-api npx prisma migrate status
# Somente com WEB_ORIGINS contendo um cliente aprovado:
# docker compose run --rm wapphub-core-api node dist/scripts/smoke.js
docker compose ps
```

`deploy` reconstrói a imagem, aguarda dependências saudáveis, aplica somente
migrations pendentes e atualiza o Core. Revise novas migrations antes de
executar; este deploy não acrescentou nem modificou migrations. Revalide a
origem interna, HTTPS externo, cookies, CORS/CSRF e logs após cada atualização.
Testes usam fixtures próprias; não rode a suíte contra dados de clientes em
produção sem um ambiente de validação separado.

Um snapshot local de rollback foi preservado em
`.git/m0-cloudflare-deploy-backup/<data>/`, com configuração anterior protegida
por permissão 600 e referência da imagem anterior. Esse material é local,
excluído do Git e do contexto Docker; nunca copie seu conteúdo para logs/PRs.

Para rollback deste primeiro preparo:

1. Preserve/commite as alterações da branch de deploy antes de trocar de branch.
2. Selecione a main validada (hash informado acima), conferindo a referência.
3. Reponha somente as configurações operacionais anteriores do `.env`, usando
   o snapshot local. Preserve senhas/chaves vigentes e qualquer rotação posterior.
4. Execute `scripts/local.sh deploy`, confira migrations, health/readiness e
   containers. A composição M0 da main mantém a API em loopback, fora da ingress.
5. Se a rota pública tiver sido ativada, desative somente o hostname da API no
   painel Cloudflare durante o rollback. Preserve o túnel e as demais rotas.

Não remova volumes, não recrie o banco, não reverta migrations aplicadas e não
use reset --hard/clean para executar rollback. M1 permanece fora do escopo.

## Arquivos da preparação

- `compose.yml` e `.env.example`: rede ingress e configuração explícita do connector.
- `src/http/app.ts`, `src/http/client-ip.ts`, `src/infrastructure/config.ts`:
  trustProxy desabilitado e IP de visitante restrito ao socket do connector.
- `tests/foundation.test.ts`: quatro regressões de proxy/configuração/origens.
- `docs/openapi.json`: nome do cookie de produção.
- `docs/DEPLOYMENT.md`, `docs/LOCAL_DEVELOPMENT.md`, `docs/M0_VALIDATION.md`,
  `docs/SECURITY_PRIVACY.md`, `docs/STATUS.md`: procedimentos e evidências reais.
- `.env` local (não versionado): modo de produção, lista de clientes web autorizados e IP fixo,
  preservando as credenciais existentes.

## Desenvolvimento M1 isolado

A implementação backend M1 em feat/m1-chat-internal não constitui promoção de
produção. Produção permanece na main M0 validada
`b790b6ce7ee427f931f84c5d0ac0ef1dd6d53fc5`, com imagem/container existentes.
Para desenvolver/validar M1, usar somente compose.test.yml/scripts/m1-test.sh
conforme LOCAL_DEVELOPMENT.md: projeto, banco, Redis, volumes e imagem próprios;
porta 3101 de loopback e nenhuma participação na cloudflare_ingress. Não
executar local.sh deploy/validate nesta branch contra o ambiente de produção.
Nenhuma configuração externa da Cloudflare foi alterada nesta entrega M1.


## Produção M1 Core — 2026-10-08 UTC

Deploy do commit `89ca5d139ffd6b7e90bfe75a2c60db72621d695a`, com main limpa e
sincronizada. Imagem API/Worker `sha256:d736cfc383e6158b4f8065b9de690b38404256a3f8c2d0b0dee2637c44f49a62`,
identificada também por `wapphub-core:m1-89ca5d1` (Compose usa `wapphub-core:local`).

- Backup lógico pré-migration: `/home/uillan/homelab/backups/wapphub-core/wapphub-core-pre-m1-20261008-022619.sql.gz`, **10.192 bytes**,
  `mariadb-dump --single-transaction --quick`, comprimido, não vazio e `gzip -t` válido;
  permissão 600, fora do volume MariaDB. Restore não foi exercitado nesta execução.
- Banco `wapphub`, container `wapphub-core-wapphub-db-1`, volume `wapphub-core_db-data`;
  aproximadamente 22 GB livres antes do deploy.
- Duas migrations M0 aplicadas antes; checksums iguais aos arquivos versionados,
  sem alterações, diff M0 sem divergência. Somente duas migrations M1 pendentes.
- SQL M1 revisado: tabelas novas com índices/FKs tenant-aware e coluna nullable
  em RealtimeEvent nova; sem DROP ou alterações destrutivas em tabelas M0.
- Lint/typecheck/build/Prisma validate e **53/53 testes** passaram no ambiente isolado.
- `npm run db:migrate` (Prisma migrate deploy) aplicou
  `20261008013000_m1_internal_chat` às 02:27:49.992 UTC e
  `20261008014000_m1_transfer_audience` às 02:27:50.048 UTC.
  Migrate status atualizado e diff final sem divergência.
- Somente API/Worker recriados. MariaDB/Redis e seus dados preservados;
  quatro containers healthy. MariaDB/Redis/Worker somente backend, sem portas
  publicadas; API em loopback e cloudflare_ingress.
- Health/readiness locais, no namespace do connector e externos: **200/200**.
  HTTPS externo validado por curl e Python urllib, sem bypass TLS.
- Origin temporária `https://m1-validation.wapphub.com.br` autorizada exclusivamente
  por configuração durante o smoke; hostname não publicado e Cloudflare inalterada.
  Valor anterior e final de WEB_ORIGINS vazio; API/Worker recriados após restauração;
  quatro containers healthy e health/readiness externos novamente 200/200.
- Smoke público autenticado: login/cookie Secure __Host-/sessão/CSRF; contact/list,
  conversation, message/list, retry com mesmo clientMessageId (mesmo ID e contagem 1),
  archive/unarchive, assignment, transfer FULL para outro usuário, tag, note e cursor
  com páginas distintas. Origin inválida e CSRF inválido rejeitados com 403.
- WSS público: sessão autenticada, evento live, reconexão/replay pelo lastEventId.
  Dois tenants isolados; IDs estrangeiros negados em REST e eventos de A ausentes
  no socket de B. Tenants/usuários/role e dados de fixture removidos ao terminar.
  Permissions necessárias ao role temporário foram provisionadas por código;
  nenhum role/membership existente recebeu autorização adicional.
- Primeira tentativa do harness falhou por nome de role acima de 40 caracteres;
  corrigido apenas no script temporário e smoke seguinte passou.
- Logs recentes API/Worker sem exceptions/erros Prisma; Redis sem erros;
  nenhuma correspondência de padrões de segredos. MariaDB registrou warnings
  de conexões abortadas: 61 nos dez minutos anteriores e 30 durante o deploy,
  sem outros warnings/erros no intervalo. Causa não diagnosticada; não corrigida aqui.

### Rollback M1

Imagem M0 preservada: `wapphub-core:m0-rollback-b790b6c`,
`sha256:dcfcffe9be820b13eeb14f7e4e79cae646b96370fa0abf6f024ed729e524a0d9`,
referência M0 `b790b6ce7ee427f931f84c5d0ac0ef1dd6d53fc5`.
Schema aditivo mantém os modelos M0; rollback da aplicação não foi exercitado.
Override local `/tmp/wapphub-m1-rollback.yml` aponta somente API/Worker para M0:

```sh
docker compose -f compose.yml -f /tmp/wapphub-m1-rollback.yml up -d --no-deps --wait wapphub-core-api wapphub-core-worker
```

Preservar a tag M0 e reconstruir o override se /tmp for limpo. Não reverter schema
nem restaurar automaticamente o banco. Backup acima permanece disponível para
recuperação controlada, se necessária.

Limites: WEB_ORIGINS final vazio bloqueia uso autenticado REST/WS por clientes web;
smokes comprovam o backend durante a autorização temporária. Não foi feito rollout
RBAC para usuários existentes, teste de carga ou restore. Frontend, M2/M3/Meta
não iniciados; milestone M1 global com frontend permanece incompleto.


## Reconciliação somente leitura — 2026-10-08, após Demo e Lucide

Estado corrente supera os snapshots de M0/M1 interno acima; nenhum deploy foi
feito nesta auditoria. Core API/Worker executam `wapphub-core:demo-72d05aa`,
image ID `sha256:f0a209caf8ebd44db7a7e088d8e60f5a9d0c4f8e92feefeae719ee4bebf0cd26`.
Containers respectivos f3bc5488ef61 e 22e777fc13d7, iniciados 14:35:05 UTC;
MariaDB 65750f142703 e Redis 1ec5cdfb29de preservados, todos healthy.
Chat 3e23452 / `wapphub-chat:lucide-nav-3e23452` healthy.
Identificadores completos e HTTP/hash/migration evidence em
`GIT_PRODUCTION_INVENTORY_20261008.md`. Core não tem revision label; fingerprints
37 arquivos de API/Worker iguais ao commit informado. WEB_ORIGINS atual autoriza
https://chat.wapphub.com.br, superando a configuração vazia histórica.

Compose real Core: compose.yml + /tmp/wapphub-core-demo-override.yml para API/Worker.
Override aponta somente suas imagens para demo-72d05aa; Compose default não deve
ser usado implicitamente como referência de produção. Guardar configuração
operacional durável será trabalho autorizado separado, não realizado aqui.

Ledger read-only confirma Demo migrations 20261008020000_demo_provider e
20261008021000_demo_provider_rbac concluídas às 14:34:56 UTC, mais as quatro
anteriores. Checksums iguais aos arquivos Git; sem migration/seed nesta auditoria.
Não houve drift completo do schema verificado; não extrapolar do ledger.

Backup pré-Demo: /home/uillan/homelab/backups/wapphub-core/wapphub-core-pre-demo-20261008-143259.sql.gz,
19.689 bytes, permissão600, gzip -t aprovado; sem evidência de restore/criptografia,
no mesmo host. Backup pré-M1 acima também gzip íntegro. Procedimento em
DEMO_PROVIDER recomendava backup criptografado/restore isolado antes da publicação;
essas etapas não estão comprovadas. Não chamar gzip de recuperação validada.

**Rollback histórico M0/M1 anterior não deve ser executado automaticamente após
mensagens Demo:** schema/DTO antigos só entendem INTERNAL. Manter/restaurar Core
compatível com INBOUND/OUTBOUND; desativar Demo não remove dados externos nem
torna seguro downgrade. Recuperação destrutiva de banco requer plano/autorização
separados e perda posterior ao backup explicitada. Frontend pode voltar a imagem
anterior preservada mantendo Core compatível, conforme relatório do Chat.

Relatório Chat atual:
/home/uillan/homelab/deploy-records/wapphub-chat/20261008-lucide-nav-3e23452/REPORT.md.
Não foi encontrado diretório deploy-records/wapphub-core; histórico disponível
neste arquivo, backup, migrations/imagens e nota remota do PR #7. Não inventar
relatório Core independente inexistente.

A1 autorização de preview e A2 checkpoint cliente são bloqueadores reais de
aceite M1; ver matriz/arquitetura. Produção segue operacional; correções/release
futuras exigem autorização própria. Sem merge/push, alteração de containers,
Cloudflare/DNS, volumes, migrations ou dados neste processo documental.
