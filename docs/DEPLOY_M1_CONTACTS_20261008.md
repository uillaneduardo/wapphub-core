# DEPLOY CONCLUÍDO — M1 contatos e conversas internas

> Atualização de aceite final: o usuário confirmou nove cenários finais M1, além de cinco P0 e sete P1. **Homologação funcional declarada concluída**, não executada pelo Codex. [Aceite e limites](M1_FINAL_ACCEPTANCE.md). Pendência administrativa: integração Git, sem novo deploy. Os resultados/pendências abaixo registram o momento original da publicação/implementação.

Validação operacional final: 2026-10-08T21:00:55.571209+00:00 (18:00 Recife, 2026-10-08).
Branch em ambos: `feat/m1-contacts-conversation-creation`.

## Revisões e evidências reaproveitadas

Core publicado: `a45fb330ceeb6a703c463174f4fa560ad070e226`, contém funcional `e32ed65c45ec0b5bc3e5afbdccd76d533ff0c7ae` e docs `54f36654dd4414f8154d93e3ad5a11fec611cae0`.
Chat publicado: `6b04e653d03fa5b06aafad205b9c760072c01fd0`, contém funcional `be151d7e430d649fe8b2ce26b875e7b1fbfe334d`.

Pré-deploy: árvores limpas, branches/ancestralidade corretas, hashes de todos os arquivos nos manifestos conferidos (35 Core, 66 Chat). Nenhuma alteração posterior de código, dependências, lockfile, Dockerfile, Compose ou Prisma. Configuração efetiva comparada: somente imagens alteradas. 14 GB livres antes do build; cinco serviços healthy; readiness público aprovado.

Reaproveitados **224 testes (64 Core + 160 Chat)**, lint/typecheck/build/diff check, OpenAPI e Prisma previamente aprovados no ambiente isolado. Não foram reexecutados. Evidências: [implementação](M1_CONTACTS_CONVERSATION_CREATION.md) e [manifesto](evidence/M1_CONTACTS_20261008/manifest.json).

## Artefatos Docker

Dockerfiles existentes, sem atualização voluntária de dependências; npm ci e camadas apt/OpenSSL existentes em cache. Bases resolvidas e logs guardados no registro protegido. Docker build obrigatório aprovado para ambos antes de alterar containers; inclui geração Prisma/compilação Core e compilação frontend previstas nos Dockerfiles, sem testes extras. API de build Chat: https://api.wapphub.com.br. Labels de revisão correspondem aos hashes publicados.

| Artefato | Tag | Image ID | Created |
| --- | --- | --- | --- |
| Anterior preservado | `wapphub-core:p0-preview-cbaf50c` | `sha256:1f4d9ccd6d635ba7cf0a223223811099fc8718948f76c89320997b0885e8914e` | 2026-10-08T14:55:22.869303524-03:00 |
| Anterior preservado | `wapphub-chat:p1-realtime-6bbc1c4` | `sha256:4f79a87a4988a570e3ebda28b11b3f5501e884820a1a86b52c364b993320a336` | 2026-10-08T15:50:30.382415215-03:00 |
| Novo publicado | `wapphub-core:m1-contacts-a45fb33` | `sha256:e3a48fddb1b83ce6a73f85937022aa2650e54ae620db7f4501d14e01720de021` | 2026-10-08T17:59:15.327657791-03:00 |
| Novo publicado | `wapphub-chat:m1-contacts-6b04e65` | `sha256:c0d88b8c40c3363f68cc913ea35fa9a4398df03e36e6e2799fc8bf82e270926b` | 2026-10-08T17:59:14.949255841-03:00 |

RepoDigests locais:

- `wapphub-core@sha256:1f4d9ccd6d635ba7cf0a223223811099fc8718948f76c89320997b0885e8914e`
- `wapphub-chat@sha256:4f79a87a4988a570e3ebda28b11b3f5501e884820a1a86b52c364b993320a336`
- `wapphub-core@sha256:e3a48fddb1b83ce6a73f85937022aa2650e54ae620db7f4501d14e01720de021`
- `wapphub-chat@sha256:c0d88b8c40c3363f68cc913ea35fa9a4398df03e36e6e2799fc8bf82e270926b`

## Ordem e Compose efetivo

Core: `/home/uillan/homelab/apps/wapphub-core/compose.yml` e override persistente
`/home/uillan/homelab/deploy-records/wapphub-m1-contacts/20261008/compose-m1.yml`.
O override muda apenas imagens API/Worker. Config anterior usava override
`/home/uillan/homelab/deploy-records/wapphub-core/20261008-p0-preview-cbaf50c/compose-p0.yml`.
Chat: `/home/uillan/homelab/apps/wapphub-chat/compose.yml`, imagem por CHAT_IMAGE_TAG.

```sh
# diretório wapphub-core
docker compose -f compose.yml -f /home/uillan/homelab/deploy-records/wapphub-m1-contacts/20261008/compose-m1.yml up -d --no-deps --no-build --pull never --wait --wait-timeout 60 wapphub-core-api wapphub-core-worker
# somente depois do gate Core, diretório wapphub-chat
CHAT_IMAGE_TAG=m1-contacts-6b04e65 docker compose -f compose.yml up -d --no-deps --no-build --pull never --wait --wait-timeout 60 wapphub-chat
```

Gate Core aprovado antes do Chat: API/Worker/DB/Redis healthy; health e readiness públicos HTTP200; OpenAPI público idêntico ao aprovado (contratos legados mantidos, extensões aditivas), logs sem erros críticos. Chat anterior permaneceu disponível/healthy até a segunda etapa; compatibilidade contratual mantida, sem teste autenticado mutável em produção.

## Estado final e preservação

| Container | ID | StartedAt UTC | Estado |
| --- | --- | --- | --- |
| /wapphub-core-wapphub-core-api-1 | `3f929916f0393c594a9faad10fbef014342f362b0ce09fb73c31f886e988491a` | 2026-10-08T21:00:00.177663698Z | healthy |
| /wapphub-core-wapphub-core-worker-1 | `39511e2bac504aadee8b19e878062d08454315899d6670e702b852c225605550` | 2026-10-08T21:00:00.170785366Z | healthy |
| /wapphub-core-wapphub-db-1 | `65750f142703a60e3310905a9cc854d12a7733442f026577f4a232dbc44eafc8` | 2026-10-07T23:52:48.955973259Z | healthy |
| /wapphub-core-wapphub-redis-1 | `1ec5cdfb29de467a5d520ce32150431203c2a85cbd210d18f264a16a7f99e6e8` | 2026-10-07T23:52:48.942135077Z | healthy |
| /wapphub-chat-wapphub-chat-1 | `f8c1fa8d2f2449c75c52a25233c7f76441f7d3259e3bcfe01a826afc524d2400` | 2026-10-08T21:00:32.287474336Z | healthy |

API e Worker executam a mesma imagem nova; Chat executa imagem nova. MariaDB e Redis preservados: IDs e StartedAt iguais ao pré-deploy. API/Worker não foram recriados durante a etapa Chat. Imagens antigas permanecem disponíveis. Configurações, portas, redes, volumes, segredos e demais aplicações preservados; nenhum comando executado sobre outros serviços.

Nenhuma migration, seed, backup/restauração de banco, SQL ou criação/alteração de dados comerciais. Nenhum browser/screenshot, push/merge, mudança de Cloudflare ou implementação M2.

## Smokes HTTP e integridade

API /api/v1/health e /api/v1/health/ready: HTTP200, status ok/ready. OpenAPI publicado igual ao arquivo aprovado.

| Rota/asset | HTTP | SHA-256 do corpo |
| --- | --- | --- |
| `/login` | 200 | `3f641b963efbfa80c3876e1eb5918ce2113dde7cb017ca56e34261e01a2d57a7` |
| `/app/contacts` | 200 | `3f641b963efbfa80c3876e1eb5918ce2113dde7cb017ca56e34261e01a2d57a7` |
| `/app/contacts/00000000-0000-0000-0000-000000000000` | 200 | `3f641b963efbfa80c3876e1eb5918ce2113dde7cb017ca56e34261e01a2d57a7` |
| `/app/conversations` | 200 | `3f641b963efbfa80c3876e1eb5918ce2113dde7cb017ca56e34261e01a2d57a7` |
| `/app/conversations/new` | 200 | `3f641b963efbfa80c3876e1eb5918ce2113dde7cb017ca56e34261e01a2d57a7` |
| `/app/settings/providers` | 200 | `3f641b963efbfa80c3876e1eb5918ce2113dde7cb017ca56e34261e01a2d57a7` |
| `/assets/index-BGkqusnN.js` | 200 | `ba073966156b5a478ab3790086354f1e542558736386fecadc59cb7386fb0574` |
| `/assets/index-CMrFcu90.css` | 200 | `d78edaed8549aab7c40b500a5b9650be3c2da4e3d285d2f7f63f0322daf87229` |

HTML e assets públicos comparados byte a byte com arquivos da imagem em execução. Rotas SPA retornam o shell; isso comprova disponibilidade HTTP, não fluxo autenticado ou aparência. Logs recentes API/Worker/Chat sem erros críticos/levels 50–60/exceções ou erros Nginx. Aviso esperado de configuração read-only do Nginx não é falha operacional. Nenhum rollback necessário.

## Contingência compatível

Chat P1 anterior permanece compatível com Core novo aditivo. Em falha operacional comprovada, após diagnóstico:

```sh
cd /home/uillan/homelab/apps/wapphub-chat
CHAT_IMAGE_TAG=p1-realtime-6bbc1c4 docker compose -f compose.yml up -d --no-deps --no-build --pull never --wait --wait-timeout 60 wapphub-chat
```

Se houver necessidade de retorno Core ao P0, retornar Chat P1 **primeiro**, pois Chat novo depende de busca/reutilização adicionais. Avaliar causa e compatibilidade; schema e dados não sofreram mudança por este deploy:

```sh
cd /home/uillan/homelab/apps/wapphub-core
docker compose -f compose.yml -f /home/uillan/homelab/deploy-records/wapphub-core/20261008-p0-preview-cbaf50c/compose-p0.yml up -d --no-deps --no-build --pull never --wait --wait-timeout 60 wapphub-core-api wapphub-core-worker
```

Confirmar health/readiness/SPA/assets e registrar motivo/logs. Nunca retornar Core à imagem vulnerável demo-72d05aa. Não restaurar banco nem improvisar infraestrutura.

## Registros e homologação pendente

Registro protegido: `/home/uillan/homelab/deploy-records/wapphub-m1-contacts/20261008/`, com before/core-gate/final.json, configs privadas (não versionadas), builds, deploys, logs, IDs/digests, override e contingência. Arquivos funcionais continuam equivalentes aos manifestos após publicação; commits posteriores somente documentais.

Validação funcional prévia: aprovada isoladamente. Validação operacional do deploy: aprovada em produção. **Homologação funcional/visual dos novos fluxos pendente**, não concluída pelo smoke HTTP. P0/P1 anteriores homologados pelo usuário.

Notebook: https://chat.wapphub.com.br/login. Testar lista/busca/cursor/cadastro/edição/duplicidade, contato Demo com identificador somente leitura, nova conversa com contato existente/inline, reutilização/inbox/envio, duplo clique/falha e reconciliação, duas Organizations/permissões, FULL/LIMITED/NONE e retomada realtime. Conferir viewports e acesso por teclado no roteiro da implementação. Criação é interna, sem canal Meta ou provisionamento Demo novo.

M1 permanece sem encerramento formal até confirmação manual e revisão final da matriz. Não iniciar etapa seguinte automaticamente.
