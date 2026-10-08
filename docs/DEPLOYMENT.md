# Deploy controlado M0 — homelab e Cloudflare Tunnel

## Estado validado

O M0 foi integrado pelo [PR #2](https://github.com/uillaneduardo/wapphub-core/pull/2)
com merge commit, preservando os três commits originais.
Main validada: `2c0982b66396753fcaa32dca9e8e6e308d434b85`.
Após o merge: 25 testes, lint, typecheck, build, smoke HTTP, migrations e
health/readiness passaram. Nenhum volume ou dado existente foi removido.

A preparação do deploy reside em `chore/m0-cloudflare-deploy`. Nessa branch,
28 testes passaram (25 do M0 e três de segurança de proxy/configuração), assim
como lint/typecheck/build e smoke HTTP em configuração de produção.
A publicação externa **não está concluída**: o hostname resolve para a Cloudflare,
mas health e readiness externos falham no handshake TLS, antes de existir
resposta HTTP. Não há autenticação administrativa Cloudflare disponível neste
ambiente para confirmar/editar a rota ou o certificado. O túnel existente não
foi recriado, reconfigurado ou reiniciado.

## Rede e origem

| Item | Configuração |
|---|---|
| Hostname pretendido | api.chat.wapphub.com.br |
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
WEB_ORIGINS=https://api.chat.wapphub.com.br
CLOUDFLARED_TRUSTED_IPS=172.19.0.250
PORT=3000
API_PORT=3000
```

As origens foram limitadas ao próprio hostname da API, pois não há frontend
implementado no M0. Adicionar um cliente web exige definir sua origem HTTPS
exata e revisar SameSite/CORS/CSRF; não use wildcard. Comandos POST exigem
Origin permitido e, quando autenticados, o token CSRF vinculado à sessão.

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

## Etapa manual pendente na Cloudflare

No túnel existente utilizado por `cloudflare-cloudflared-1`, confirmar/criar a
rota de aplicação pública com:

- hostname: **api.chat.wapphub.com.br**;
- tipo do serviço: **HTTP**;
- service/origin: **http://wapphub-core-api:3000**;
- porta: **3000**;
- rede Docker: **cloudflare_ingress**;
- serviço Compose: **wapphub-core-api**.

Confirmar um certificado edge ativo que cubra o hostname exato. Não é possível
atribuir a falha TLS a uma configuração específica sem acesso ao painel.
Como se trata de subdomínio em múltiplos níveis, confira a cobertura conforme
as [limitações de Universal SSL](https://developers.cloudflare.com/ssl/edge-certificates/universal-ssl/limitations/).
Não desative validação TLS, não troque o domínio solicitado e não substitua o
túnel para contornar a falha. Somente essa rota da API deve ser publicada.

Depois da configuração manual:

```sh
curl --fail https://api.chat.wapphub.com.br/api/v1/health
curl --fail https://api.chat.wapphub.com.br/api/v1/health/ready
```

Ambos devem retornar HTTP 200 com os contratos do Core. Confirmar também o
fluxo HTTPS de login/CSRF/logout e o encaminhamento real do IP de visitante
antes de marcar o deploy externo como concluído.

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
docker compose run --rm wapphub-core-api node dist/scripts/smoke.js
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
- `tests/foundation.test.ts`: três regressões de rate limiting/configuração.
- `docs/openapi.json`: nome do cookie de produção.
- `docs/DEPLOYMENT.md`, `docs/LOCAL_DEVELOPMENT.md`, `docs/M0_VALIDATION.md`,
  `docs/SECURITY_PRIVACY.md`, `docs/STATUS.md`: procedimentos e evidências reais.
- `.env` local (não versionado): modo de produção, Origin HTTPS e IP fixo,
  preservando as credenciais existentes.
