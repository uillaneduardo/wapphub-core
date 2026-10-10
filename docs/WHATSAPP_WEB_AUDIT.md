# Auditoria WhatsApp Web — 2026-10-10, antes da implementação

Atualização CP2: usuário aprovou explicitamente Baileys7.0.0-rc14. Plano inicial de
schema/Core foi separado para CP3 para preservar integralmente os serviços neste
checkpoint: adapter independente com vault/journal criptografados locais, sem
migration/consumer Core ativado. [Decisão vigente](WHATSAPP_WEB_CHECKPOINT2.md).
O diagnóstico/plano original abaixo é preservado como registro anterior à decisão.

## Estado confirmado

Core main/origin/main limpos em c427fb6cb55a05b1e651ef63cd25cdd382fb0ed9.
API/Worker executam wapphub-core:m2.1-rbac-c427fb6, healthy.
Chat main/origin/main limpos em fbd0f41e2056fdc00b9024d9edf70471ae7cf0c5;
imagem wapphub-chat:m21-ui-polish-fbd0f41, healthy.
MariaDB/Redis healthy; Cloudflare connector preservado. Inventário sem segredos
em /home/uillan/homelab/deploy-records/wapphub-provider-web/20261010/initial-containers.json.
Diretório deploy-records existe e é adequado. Platform não possui clone nesse
workspace e não será modificada. Nenhum repositório/provider dedicado encontrado.
Serviço independente pode ficar em services/wapphub-provider-web no repositório
Core, com package/lockfile/Dockerfile próprios, sem criar remoto adicional.

## Arquitetura/fluxos reutilizáveis

Fastify/TypeScript, Prisma6/MariaDB11.4 e Redis7.4. Sessão server-side por cookie,
Origin/CSRF, contexto de Organization e Membership ativa/permissions efetivas do M2.1.
Chat.context/mutation revalidam segurança; lock Organization + transação READ COMMITTED
ordena domínio/realtime até commit. Autorização de conversa, visibleFromMessage e
supervisão protegem histórico/preview/replay. AuditEvent registra ações humanas.
MessageIngestionService é a entrada persistida comum; DemoProvider implementa
MessagingProvider. Conversas, mensagens, autoria e identidades pertencem ao Core.

Demo entrada: simulador autorizado → resolução Channel/ContactIdentity/Conversation
no tenant → parseInbound → persistInbound → Message + eventos transacionais.
Demo saída: send → autorização/idempotência → sendText determinístico → Message →
realtime. IDs externos únicos por Organization/Channel, clientMessageId por conversa.
Tipos/direção são strings, status enum PENDING/SENT/DELIVERED/READ/FAILED; schema
possui vínculo com canal/autor interno ou contato. Nenhum payload externo bruto.
Core domínio não importa SDK externo. Meta é apenas IN_DEVELOPMENT, não implementada.

Realtime versão1 transporta IDs; REST busca conteúdo autorizado. MariaDB persiste
RealtimeEvent; Redis Pub/Sub notifica e catch-up SQL recupera falhas. Não há Redis
Streams persistidos. Redis produção usa appendonly=no e save vazio: não pode ser a
única fonte de filas duráveis. Worker atual somente mantém conexões, sem jobs.

## Contratos e limites atuais

MessagingProvider cobre apenas sendText/parseInbound. Entrada normalizada tem
providerMessageId/body, sem envelope de lifecycle/capabilities/media. Body original
é persistido; assinatura não é aplicada pelo transporte Demo. REST/OpenAPI vigente
em docs/openapi.json e /api/v1/openapi.json; DTOs legados devem permanecer compatíveis.
Channel é único por Organization/provider: preservar, inicialmente uma conexão Web
por Organization. Não remover unicidade nem criar plataforma de conversas paralela.
Não existe modelo Media/object storage/upload/download/captura no backend atual.
Chat tem ferramentas multimídia desabilitadas, history TEXT e providers Demo/Meta.
A nova UI só ficará ativa após contratos reais no backend e tests correspondentes.

## Riscos e decisões

1. Chamadas externas não podem ficar dentro da transação/lock por Organization:
   usar outbox durável SQL + Worker, mantendo caminho Demo determinístico.
2. Redis Streams exigiria evolução de persistência; preferir filas SQL autoritativas
   com leases/retry/ack/dead-letter e Redis como notificação opcional. Sem broker novo.
3. Transferência/replay/mídia precisam respeitar o mesmo limite histórico, não só
   Organization. Revalidar leitura de Message/conversa em cada acesso ao arquivo.
4. Sessões Baileys: AES-256-GCM com AAD Organization/conexão/registro, volume persistente,
   chave fora do Git/imagem/log, escrita atômica serializada, exclusão mútua/lease
   com fencing e shutdown/backoff limitado; logout/revogação não reconectam infinitamente.
5. QR/telefone e conteúdo são dados sensíveis: apenas REST autorizado, no-store;
   notificações realtime contêm IDs, nunca QR/auth/media. Logger SDK silent.
6. Risco de resposta perdida durante envio: idempotência persistida e estado explícito
   de resultado incerto; não prometer exactly-once externo nem reenviar cegamente.
7. Serviço em rede privada sem ports/ingress; egress próprio para WhatsApp. Comandos
   internos autenticados, limites/validação escopados; nenhuma conta é ligada no boot.
8. Disco livre auditado ~14GB em filesystem98GB; RAM total7.3GB, available~4.2GB e
   swap usada~2GB. Build/test sequenciais, limites de arquivos/fila/concurrency, streams
   para transporte binário; sem base64/media em bus e sem transcodificação pesada.
9. Versão Baileys exige decisão: registry baileys e @whiskeysockets/baileys apontam
   latest7.0.0-rc14 e legacy6.7.24. Política oficial declara <7 sem manutenção de
   segurança. Requisito de versão estável conflita com RC mantida. Pergunta enviada
   ao usuário; serviço dependente não será publicado sem resolver essa escolha.

Fontes primárias consultadas:
- https://github.com/WhiskeySockets/Baileys/releases
- https://github.com/WhiskeySockets/Baileys/blob/master/SECURITY.md
- npm view baileys e @whiskeysockets/baileys dist-tags/version em 2026-10-10.
Não inferir estabilidade de RC nem usar master/latest flutuante.

## Mudanças e migrations planejadas

Checkpoint1: contrato universal versionado/validado com eventos recebida/enviada/
atualizada/falha/exclusão/conexão/mídia, identidade/direção/IDs/capabilities,
referências e dedup escopada. Demo reutiliza normalização preservando DTO/IDs.
Sem schema/migration/REST/realtime novo necessário para esse checkpoint.

Checkpoint2: serviço isolado, transporte autenticado e outbox/inbox duráveis.
Schema aditivo para estado de conexão, comandos/eventos processados, leases/retries
com índices tenant-aware; campos opcionais de mensagem para transmittedBody, timestamp
externo/tombstone, mantendo body original e contratos legados. Novos modelos Media
com FK tenant/conversa/mensagem, estado de transferência e referência de blob.
DDL somente aditivo, revisado/validado em DB isolado; nenhum DROP/dados removidos.
Não modificar migrations antigas. Drift atual tem cinco nomes de FK M1 documentados
em scripts/expected-m1-foreign-key-names.txt; baseline deve permanecer igual.

Checkpoint3: Core endpoints versionados, RBAC existente providers.manage/messages.*, media
sob mesma autorização de conversa; OpenAPI e Chat atualizados coordenadamente.
Upload binário independente, download seguro sob demanda/Range, limites de tipo/tamanho,
miniaturas quando suportadas sem conversão crítica. Áudio local MediaRecorder com preview/
cancel/regravar e envio explícito. Vídeo: reprodução de anexos; captura só se plenamente
validada. Sem envio em massa nem contatos reais em testes sintéticos.

## Validação e publicação

Unidade/integração: normalização, DTO Demo, tenant/RBAC/histórico, idempotência/autoria,
status/assinatura, concorrência/leases/recovery, auth encrypted/log privacy,
mídia/arquivo isolado/retry/tamanho, websocket referência, OpenAPI, regressões M1/M2.1.
Lint/typecheck/build e migrations em ambiente isolado, nunca suite mutável em produção.
Medir latência/memória/CPU/filas com carga sintética; não declarar metas como resultados.
Antes de alteração de produção, dump verificável + restore em DB isolado, imagens
anteriores preservadas, revisão de integridade e checks. Só API/Worker/provider/Chat
necessários, em checkpoints. DB/Redis/Platform/Tunnel preservados. Nunca compose down.

## Rollback

Checkpoint1: voltar somente API/Worker à imagem anterior (schema/contratos iguais).
Checkpoints com schema/mídia: manter migrations aditivas e filas/dados. Desabilitar
nova conexão e interromper novas saídas; preservar auth/blob/SQL e IDs externos.
Rollback deve usar versão que conheça os novos tipos/dados, ou feature gate que
bloqueie o novo provider mantendo leitura. Não voltar automaticamente a Core que
não entende novos tipos após uso real, não restaurar banco perdendo dados recentes,
não reverter migrations destrutivamente. Se risco/incompatibilidade aparecer,
interromper publicação afetada e solicitar decisão. Homologação nunca é presumida.
