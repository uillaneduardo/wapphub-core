# WhatsApp Web — publicação técnica do Checkpoint 3

Publicado em 10/10/2026, verificado às 2026-10-10T20:09:26.709854+00:00. Implementação,
merge, migration e deploy técnico concluídos. Checkpoint 4, homologação manual e
eventual vínculo de aparelho continuam pendentes pelo usuário. Zero contas reais,
zero QR solicitado em produção e zero mensagem externa enviada pelo agente.
Envio pelo Chat e multimídia continuam bloqueados.

## Código e gates

- [Core PR13](https://github.com/uillaneduardo/wapphub-core/pull/13), merge commit `42a76516c051bdf6a138b5182c496bca2c1776a0`.
- [Chat PR10](https://github.com/uillaneduardo/wapphub-chat/pull/10), merge commit `da38c2f620f191e3e2f030caf4cd0b8d881cc4fd`.
- Correção HTTP `8328d6c`: não enviar Content-Type JSON em requisição sem corpo;
  regressão usa Fastify real e mantém o protocolo HMAC.
- Core completo reexecutado: 103 testes, lint/typecheck/build/OpenAPI/Prisma/drift.
  Provider: 36 testes; Chat: 249 testes, confirmados pelos respectivos CIs.
  Audits atualizados dos três pacotes: zero vulnerabilidades.
- CI de PR Core 38082239963, Provider 38082239881, Chat 38072587483: success.
- CI nos merges publicados: [Core](https://github.com/uillaneduardo/wapphub-core/actions/runs/38082423216),
  [Provider](https://github.com/uillaneduardo/wapphub-core/actions/runs/38082423220),
  [Chat](https://github.com/uillaneduardo/wapphub-chat/actions/runs/38082426088): success.
- Imagens candidatas e finais: interoperabilidade real em rede none, chave sintética,
  criação ociosa/estado/journal/HMAC/QR ausente/connect bloqueado aprovados.
  Imports de contrato e runtime validados. As árvores dos merges são iguais às
  dos HEADs dos PRs aprovados; commits posteriores de documentação não mudam as imagens.

## Imagens e publicação

| Serviço | Anterior preservada | Publicada |
| --- | --- | --- |
| API | wapphub-core:web-normalization-5e9cad5 | wapphub-core:cp3-42a7651 |
| Worker | wapphub-core:m2.1-rbac-c427fb6 | wapphub-core:cp3-42a7651 |
| Provider | wapphub-provider-web:cp2-194765f | wapphub-provider-web:cp3-42a7651 |
| Chat | wapphub-chat:m21-ui-polish-fbd0f41 | wapphub-chat:cp3-da38c2f |

Labels OCI revision correspondem aos SHAs dos merges. Core usa Node
v22.23.2 (igual à candidata efetivamente testada);
Provider usa Node v22.23.3 e Baileys exatamente
7.0.0-rc14. A afirmação anterior de que todas as candidatas usavam 22.23.3 foi
conferida: Core usa 22.23.2, conforme a base vigente do seu Dockerfile.

Foi aplicado somente `20261010170000_whatsapp_web_core_integration` por
`prisma migrate deploy` na imagem validada: ledger de 7 para 8 migrations,
checksums verificados. Provider, API/Worker e Chat foram publicados nessa ordem
por Compose com serviços explícitos, --no-deps e --no-build. Sem compose down.
Overlays versionados: Core compose.provider-web.yml; Provider
compose.chat-integration.yml. Comunicação autenticada e heartbeat aprovados antes
da publicação do Chat. Connect é aceito somente após comando explícito autorizado.

## Backups e dados

Banco: `/home/uillan/homelab/backups/wapphub-core/wapphub-core-pre-web-cp3-20261010-200825.sql.gz`; 61285 bytes; SHA256
`e77e4a76ee02080fabfa12a595fb3982a35402feb23ce5dacf698e6ac17c1286`. Gzip/restauração isolada/migration aditiva/drift/integridade
aprovados imediatamente antes da publicação. Oito verificações tenant com zero
violações; contagens existentes preservadas após migration em produção.

Provider: `/home/uillan/homelab/backups/wapphub-provider-web/pre-cp3-20261010-200836/sessions.tar.gz`; SHA256
`df612c7d3e392d078e6c2d2ab7006a53b813176b0e53672bf47eea3683ebc296`. Arquivo íntegro e extração isolada verificada;
chaves preservadas em backup protegido separado. Segredos nunca aparecem nos
relatórios ou logs. Volumes e chaves de produção foram preservados.

Em produção: Organization 1, User 3, Membership 3, override 1, Channel 1,
Conversation 6, Message 42, Role 3, Permission 19, RolePermission 48.
ProviderConnection/ProviderCommand/ProviderInbox e sessões do Provider: zero.
Canal Demo permanece ENABLED. Nenhuma conexão criada pelo deploy.

## Verificação operacional

Seis serviços healthy: API, Worker, Provider, Chat, DB e Redis. IDs e startedAt de
37 outros containers preservados, incluindo DB/Redis/Tunnel e ambientes de teste.
Provider sem ports/ingress, apenas backend/egress, read-only, ALL capabilities
removidas, secrets por arquivo. Endpoints privados exigem HMAC; acesso sem chave
retorna 401. Worker mostra PROVIDER_WORKER_READY e heartbeat válido.

17 verificações HTTP aprovadas: health local/HTTPS; endpoints de conexão, QR e
replay retornam 401 sem sessão; QR tem no-store/private; OpenAPI publicado contém
CP3; página de providers, login, conversas e Demo têm fallback SPA; JS/CSS finais
servem 200 e contêm a configuração Core esperada. Logs de startup/smoke conferidos
sem segredos, QR, credenciais, tokens, senha ou stack. Nenhum browser foi executado.

Três amostras reais de idle, sem sessões WhatsApp ou gerador de carga, com
healthchecks ativos. Janela: 2026-10-10T20:09:52.899942+00:00 a 2026-10-10T20:10:16.985523+00:00.
São observações curtas, não benchmark/SLA ou validação de carga.

| Container | CPU nas três amostras | Memória nas três amostras |
| --- | --- | --- |
| wapphub-core-wapphub-core-api-1 | 0.02%, 0.02%, 0.02% | 72.9MiB, 72.95MiB, 73.11MiB |
| wapphub-core-wapphub-core-worker-1 | 0.00%, 0.28%, 0.00% | 57.85MiB, 58.16MiB, 58.57MiB |
| wapphub-provider-web-provider-web-1 | 0.01%, 0.00%, 0.00% | 67.6MiB, 67.64MiB, 67.66MiB |
| wapphub-chat-wapphub-chat-1 | 0.00%, 0.00%, 0.00% | 6.562MiB, 6.562MiB, 6.562MiB |

Filas Provider pending/dead e comandos Core: zero. Nenhum dado real de WhatsApp
foi ingerido; desempenho com conta/carga real não foi medido.

## Rollback e homologação

Antes de existir vínculo/dado Web: interromper Worker, bloquear integração e
restaurar separadamente imagens antigas API/Worker/Chat/Provider com connect=false.
Manter migration aditiva, histórico, inbox, comandos, volumes e chaves. Não restaurar
banco ou executar DDL inversa como rollback de aplicação. Após dados Web, primeiro
desabilitar integração na versão compatível e avaliar leitura do histórico antes
de trocar para imagens antigas. Procedimento e overlays locais em /home/uillan/homelab/deploy-records/wapphub-provider-web/20261010-checkpoint3/continuacao/ROLLBACK.md.

Homologação manual no notebook em
https://chat.wapphub.com.br/app/settings/providers: criação ociosa; solicitar QR;
expiração/renovação/estados/falhas; troca de Organization/permissões; confirmação e
cancelamento de desconexão; teclado/mobile; regressão Demo. Vincular aparelho é
decisão humana explícita. Envio e mídia permanecem indisponíveis mesmo após vínculo.

Evidências detalhadas: `/home/uillan/homelab/deploy-records/wapphub-provider-web/20261010-checkpoint3/continuacao` — baseline, gates, merges, final-images,
backups/restauração, deploy-steps, verification e idle-samples. RETOMADA.md original
permanece como histórico da entrega anterior; esta publicação o sucede.
