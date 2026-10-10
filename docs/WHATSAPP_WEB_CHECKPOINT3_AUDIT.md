# Auditoria anterior ao schema — checkpoint 3, 2026-10-10

Core/main real194765f, Chat/main fbd0f41, ambos limpos. API executa imagem CP1
web-normalization-5e9cad5; Worker m2.1-rbac-c427fb6; Chat m21-ui-polish-fbd0f41.
Provider cp2-194765f healthy, sem ports/ingress, sessões0 e connect=false.
DB/Redis/Tunnel intactos;41 containers existentes. Disco14GB livre/RAM available4.2GB.
Produção Core SHA informado é o repositório; runtime API foi preservado no CP2.

## Reuso e diferenças

CP1 fornece eventos estritos64KiB, identidade/direção/autoria/receipts, conteúdo
original separado de apresentação, dedup escopada e referências multimídia25MiB.
CP2 tem REST interno HMAC/replay persistido, lifecycle/QR em memória20s, timeout120s,
vault criptografado/lock singleton, journal pull/ack/nack/leases/dead letter.
Não existe consumer Core/outbox. GET session não inclui qrRevision; refresh de QR
expirado precisa reiniciar pairing explicitamente, sem interromper sessão CONNECTED.

Core usa Channel único Organization/provider, ContactIdentity tenant/channel,
Conversation e Message com IDs externos únicos escopados. MessageIngestionService
é a entrada comum do Demo. Chat.mutation usa lock Organization + READ COMMITTED;
domínio/auditoria/realtime commitam juntos. Foundation/session/context revalidam
Membership ativa/permissões efetivas e CSRF/Origin. providers.manage é permission
real existente, não criar novas permissions/roles. AuditEvent exige ator humano;
eventos de integração não podem fingir atendente. Redis PubSub somente notifica;
RealtimeEvent SQL recupera notificações perdidas. Worker atual não tem jobs.

ProvidersPage usa catálogo Core (DEMO/META), componentes/tokens atuais, simulador
segregado. API é o único destino do navegador. Main realtime exige conversations.read;
gerenciador pode ter providers.manage sem acesso às conversas. Acrescentar stream
restrito de providers no mesmo Gateway/RealtimeClient, sem ampliar guardas M1.
Nenhum QR nos eventos/logs/cache/storage browser. Atualização por IDs e REST autorizado.

## Implementação/migrations aditivas propostas

ProviderConnection: Channel FK composta, metadata/versão/qrRevision confirmadas pelo
provider, lease/fencing e lastCheckedAt; nenhuma credencial/QR em SQL.
ProviderCommand: intent atômico, escopo/ator/sessão/comando UUID, expectedVersion,
retries limitados/lease/conclusão segura. Worker revalida autorização antes de atuar.
ProviderInbox: dedup autoritativa/correlação/hash/tipo por tenant/channel, atomicidade
com ingestão Message e eventos; não duplicar payload externo nem regras de conversa.
Message: transmittedBody/providerOccurredAt nullable, preservando body/createdAt M1.
DDL somente CREATE/ADD e FKs compostas; sem dados/permissions/migrations antigas alterados.
Baseline dos5 nomes de FK M1 permanece; diff SQL nunca executado em produção.

Core expõe create/read/command/QR só com providers.manage; estado confirmado e intent
pendente separados. QR no-store/expiração/reautorização após chamada interna.
Core/Worker compartilham assinatura HMAC canônica (contrato em contracts, sem SDK).
Provider acrescenta qrRevision e comando de refresh limitado ao pairing. Conexões
habilitadas na infraestrutura somente após gates; startup vazio não cria socket.
Botões reais exigem ação humana. Desconectar revoga auth para não restaurar vínculo.

Texto recebido/eco de DEVICE/receipts passam por normalização/persistência comuns,
sem atribuir userId falso; IDs/realtime/histórico/tenant preservados. Envio Web fica
bloqueado no backend/UI; nenhum outbound/bulk real. Mídia já possui contrato CP1;
não há storage/model Media/endpoints autorizados por conversa/upload/range/miniaturas.
Documentar dependências e manter anexos indisponíveis, sem base64/transcodificação.

## Gates e rollback

DB/Redis isolados para migrations/tests completos e negativos de tenant/permissão;
testes de ciclo/QR/expiração/refresh/revogações/Worker/fencing/ack/realtime e Demo.
lint/typecheck/build/OpenAPI/Prisma/drift/npm audit em Core/Provider/Chat, CI/PRs
compatíveis e merge commits. Nenhum browser/Playwright/screenshot no homelab.
Backups DB com restore/integridade + volume/chaves provider antes de produção;
imagens anteriores preservadas. Não alterar Platform/Meta/Tunnel/volumes/DB/Redis.

Rollback conserva schema aditivo: desabilitar novos comandos e ingress Web, parar
Worker de integração e restaurar imagens API/Worker/Chat/Provider anteriores, com
connect=false e sem restaurar banco. Após dados Web, avaliar compatibilidade de
leitura do frontend anterior antes de revertê-lo; nenhuma migration destrutiva.
Homologação QR e eventual vínculo real somente por usuário, nunca pelo agente.
