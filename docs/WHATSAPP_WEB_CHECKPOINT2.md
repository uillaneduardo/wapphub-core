# WhatsApp Web — serviço isolado, checkpoint 2

Decisão do usuário em 2026-10-10: Baileys **7.0.0-rc14** explicitamente aprovado,
fixado em package.json e package-lock próprios. Serviço em
`services/wapphub-provider-web`; nenhum SDK/dependência nova no runtime Core.
Autorização limitada à publicação interna sem contas reais. Integração de
endpoints públicos/Chat e consumo pelo Core pertencem ao checkpoint 3.

## Segurança e arquitetura

Node22.22.1 (SDK exige>=20), imagem Debian bookworm-slim. SDK importado e credenciais
criptográficas geradas/restauradas nos testes sem abrir socket WhatsApp.
GHSA-qvv5-jq5g-4cgg/CVE-2026-48063 foi corrigida em rc12; rc14 contém a correção.
Referência oficial: https://github.com/WhiskeySockets/Baileys/security/advisories/GHSA-qvv5-jq5g-4cgg.
History sync desativado e upserts com requestId descartados adicionalmente.
Peer sharp0.35.5 fixado após corrigir advisories de libvips/libheif/librsvg das
versões anteriores; npm ci/audit retornaram zero vulnerabilidades na árvore
completa instalada. Lock registra versões/integridade das transitivas; sem Git/master.
Revalidar auditoria em CI e antes de futuras publicações; ausência de advisory não
prova ausência de vulnerabilidade. Dependências opcionais de mídia não são habilitadas.

Compose independente, sem ports, sem Cloudflare/ingress, rede backend real existente
`wapphub-core_backend` e bridge própria somente para eventual egress. Não recebe
credenciais DB/Redis/Core, não muda containers/redes dos serviços existentes.
Rootfs read-only, usuário node, capabilities removidas, no-new-privileges,
512MiB/1CPU/128 processos, tmpfs16MiB e logs rotacionados. Sem migrations.
Segredos independentes de32bytes fora do Git/imagem, arquivos600 montados read-only.
Volumes/chaves devem ser preservados juntos em backup protegido. Rotação de chave
exige ferramenta de recriptografia e manutenção; não trocar chave arbitrariamente.

Vault AES-256-GCM por escopo Organization/Connection com nonce aleatório e AAD
vinculado à versão/nome SHA256. Credenciais, chaves Signal, comandos e eventos são
criptografados. Escrita temporária600, fsync, rename e fsync do diretório; memória
só muda após commit. Tampering/chave errada impedem startup/readiness. Nenhum payload
externo bruto é persistido. QR só em memória e via REST interno autorizado/no-store;
envelope CP1 carrega revisão/expiração, nunca QR/auth/bytes. Logs SDK silent;
logs próprios contêm códigos públicos, sem request/erro bruto/JID/número/conteúdo.

`flock --no-fork --nonblock` mantém lock de kernel por todo processo, liberado em
crash. Impede writers concorrentes do mesmo volume. Não remover o inode nem usar
lock por timestamp. Modelo deliberadamente de **instância única por volume**;
escala horizontal/discos compartilhados remotos exigem outra decisão e fencing
distribuído. Serialização por sessão e vault impede lost updates; gerações ignoram
callbacks antigos. Baileys Signal auth usa o vault; não useMultiFileAuthState plaintext.

Até16 sessões,8MiB/registro e64MiB de registros;512 eventos/escopo, dedup limitada
a4096 IDs/escopo e256 recibos de comandos. Esses limites são operacionais, não
garantia de retenção infinita/exatamente uma vez. Core deverá manter inbox/dedup
autoritativa antes de ativar contas. Saturação/falha de persistência fecha transporte
e degrada readiness; correção operacional/restart após preservar volume/chaves.

## Lifecycle e contrato de integração

Criação permanece DISCONNECTED; conexão exige comando explícito, chave interna e
`ALLOW_SESSION_CONNECT=true`. Compose CP2 fixa **false**. Startup com volume vazio
nunca cria socket; recupera intent persistido somente quando conexão autorizada.
QR rotativo com expiração conservadora20s; pairing termina após120s. Baileys
timeout20s/keepalive30s. Reconexão exponencial1/2/4/8s+jitter, máximo5 tentativas
por ciclo, contador persistido inclusive após reinício. Open não zera orçamento,
evitando flapping infinito. Novo ciclo exige novo comando manual autorizado.
Logout401/revogação403/mismatch411/substituição440/badSession500 não reconectam;
401/500 e logout explícito removem auth. Logout remoto tem timeout5s; falha remota
é reportada por código, revogação local continua válida. Shutdown fecha sockets,
cancela timers e mantém intent/credenciais para recuperação controlada.

REST **interno**, não endpoints públicos/OpenAPI Core:

| Método | Caminho | Efeito |
| --- | --- | --- |
| GET | /health/live, /health/ready | Status genérico; readiness indica bloqueio operacional |
| GET | /internal/v1/metrics | Contagens/filas/RSS/uptime, autenticado |
| PUT/GET | /internal/v1/organizations/{organizationId}/connections/{connectionId} | Criar/consultar sessão no escopo |
| GET | mesmo prefixo + /qr | QR privado temporário, no-store |
| POST | mesmo prefixo + /commands | action connect/disconnect/logout; commandId UUID |
| POST | mesmo prefixo + /events/pull | limit1..20, lease30s/attempt |
| POST | mesmo prefixo + /events/ack ou /events/nack | eventId/leaseId; ack após commit Core |
| POST | mesmo prefixo + /events/retry | eventId em dead letter; recuperação explícita |

HMAC-SHA256 com client=core, método, URL exata, timestamp(ms), nonce UUID e SHA256
de JSON.stringify(body ou null); serialização/cabeçalhos em src/auth.ts. Janela30s,
nonces exclusivos persistidos/fsync, limite4096, replay rejeitado mesmo após restart.
Segredo de serviço não é sessão de usuário: **Core deverá validar Membership,
permissões, Organization/Channel e auditoria antes de emitir qualquer comando**.
Provider não mantém conversas, RBAC ou nomes de perfis. Não entregar a chave ao Chat.
Nenhum endpoint fictício no Core: neste checkpoint a comunicação está preparada
por pull/ack autenticados, mas não há consumer Core/Worker ativado.

Eventos usam diretamente `contracts/provider.ts` do CP1 (não cópia), limite64KiB.
Texto de notificações diretas/identidades externas e recibos são normalizados;
originalBody preservado, mensagens próprias do dispositivo não fingem userId de
atendente. Sem history/groups/broadcast/placeholder resend. Eventos/state commitam
atomicamente no vault. Lease/ack/nack/recovery/dead letter duráveis; até5 entregas,
nack com backoff limitado60s, retry explícito. Mensagem bruta/mídia é descartada
neste checkpoint; capabilities anunciam somente TEXT/receipts/unofficial.
Sem endpoint de envio, multimídia, upload, UI ou segunda plataforma de conversas.

Decisão sobre filas: Redis atual é volátil. Este adapter usa journal criptografado
local durável no CP2; inbox/outbox SQL autoritativas e regras de mensagens do Core
serão integradas no CP3, conforme auditoria. Não altera schema Core nesta etapa.

## Testes e operação

Comandos no diretório do serviço: npm ci, npm audit --audit-level=high, npm run lint,
npm run typecheck, npm test, npm run build.35 testes cobrem SDK/options/upserts,
auth/keys criptografadas, adulteração/AAD/tenant, callbacks revogados, serialização,
HMAC/replay/payloads, comandos/QR/open/logout/retries/timeouts/generation/restart,
fila/dedup/leases/ack/nack/dead letter/readiness e lock de kernel com crash real.
CI próprio inclui build Docker; CI Core preserva todos os checks anteriores.
Regressões Core completas/Prisma/OpenAPI/drift em DB/Redis isolados, nunca produção.
Benchmark reproduzível: build seguido de node scripts/benchmark.mjs,200 eventos,
10 tenants, persistência local/ack; nenhuma conta/socket/envio externo. Métricas
medidas e inventário/restart/backup/HTTP/deploy ficam em deploy-records, não metas/SLA.

Compose exige PROVIDER_WEB_IMAGE por commit e caminhos de secrets reais. Usar
`docker compose --env-file <arquivo-protegido> -f services/wapphub-provider-web/compose.yml up -d --no-deps --no-build --pull never --wait provider-web`.
Não executar compose down nem apagar volumes. Primeira publicação não possui
imagem anterior deste serviço: rollback é `... stop provider-web`, mantendo
imagem, volume e chaves. Core/Worker/Chat/Demo/DB/Redis/Tunnel ficam intactos.
Atualizações posteriores devem preservar a imagem anterior e parar se schema
local incompatível. Não restaurar banco nem desfazer migrations de produção.

Não há homologação de conta/QR no navegador neste checkpoint. URL do Chat
continua https://chat.wapphub.com.br; gerenciamento/Demo devem permanecer iguais.
QR no Chat, envio/recebimento persistidos no Core e mídia continuam pendentes do
checkpoint3. Conta real somente por ação explícita do usuário após integração.
