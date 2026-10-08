# M1 — Backend de chat interno

Este escopo entrega somente Core/REST/WebSocket, sem frontend, Meta, canais,
mídia, catálogo comercial ou benchmark M5. Produção continua executando M0.

## Persistência e estados

Contact pertence à Organization, com identificador primário único dentro dela.
Conversation relaciona Contact da mesma Organization, atribuição atual, estado,
tags e limites de visibilidade. FKs compostas impedem vínculos de contato,
mensagem, tag ou nota com outra Organization. User permanece global.

Conversation usa OPEN/PENDING/ARCHIVED do contrato conceitual existente. O M1
cria OPEN e opera archive/unarchive (retorno OPEN); PENDING não possui comando
específico neste escopo. lastMessageAt inicia na criação para ordenação definida
inclusive em conversas sem mensagem e é atualizado por envio.

Message M1 é exclusivamente INTERNAL/TEXT. O envio aceito persiste SENT, sem
provider ou fila externa. PENDING e FAILED compõem o enum persistente, mas não
são estados fabricados no envio interno. QUEUED da arquitetura de envio externo
fica para o milestone do provider. Recibos locais permitem SENT → DELIVERED →
READ ou SENT → READ; repetição do mesmo estado é idempotente, regressão falha.
READ/DELIVERED são estados agregados locais, não comprovantes externos nem
recibos individuais de todos os participantes.

O trabalho posterior do Demo Provider adiciona direction INBOUND/OUTBOUND,
senderContactId, Channel e ContactIdentity de forma aditiva. A semântica M1
interna descrita aqui continua válida para mensagens existentes. Escopo e
validação do adaptador simulado estão em `docs/DEMO_PROVIDER.md`.

POST messages exige clientMessageId e texto não vazio. Chave única:
Organization + Conversation + clientMessageId. Retry do mesmo autor/conteúdo
retorna a mesma Message sem outro evento. Reuso com autor/conteúdo diferente
retorna IDEMPOTENCY_CONFLICT (409). IDs são strings até 100 caracteres; recomenda-se
UUID. Unicidade segue a collation MariaDB utf8mb4_unicode_ci, sem diferenciar
maiúsculas/minúsculas. Message tem UUID público e sequência interna indexada.

Domínio, AuditEvent e RealtimeEvent são gravados na mesma transação. Um lock
na linha da Organization serializa comandos desse tenant e alocação dos IDs
de evento até o commit. Assim, uma transação atrasada não aparece abaixo de um
checkpoint já entregue. Tenants diferentes não compartilham esse lock. Essa
escolha simples será medida no benchmark posterior; não declara escala M5.

## Autorização, assignment e transferência

Toda operação passa por sessão revogável, User ativo, Organization Context,
Membership ativa, permission e regra operacional. Comandos revalidam sessão,
contexto, Membership e permissions dentro da transação. Não há organizationId
aceito nos payloads operacionais nem condicionais por role nos casos de uso.

Sem supervisão, um agente acessa conversas não atribuídas ou atribuídas a si.
Assignment aceita um destinatário com User/Membership ativos no mesmo tenant e
permissions conversations.read/messages.read. Agente pode assumir conversa
não atribuída; atribuir a outra pessoa exige conversations.supervise. Alterar
uma atribuição existente exige transfer (não há unassign neste escopo).
Transfer só aceita conversa atribuída e aberta. Antigo atendente perde acesso
após a transferência, salvo se possuir permission administrativa de supervisão.

ConversationAssignmentHistory registra autor, origem, destinatário, modalidade,
limites e nota opcional; não há outra tabela redundante de transferência.

| Modalidade | Histórico de mensagens do novo atendente |
|---|---|
| FULL | Todas as mensagens permitidas por suas permissions |
| LIMITED | Últimas N mensagens existentes ao transferir, mais mensagens futuras |
| NONE | Somente mensagens posteriores à transferência |

N deve estar entre 1 e 1000 e só é aceito em LIMITED. Os limites são sequências
persistentes, nunca cópias ou deleções. Para LIMITED/NONE, notas anteriores ficam
ocultas; uma nota opcional de handover é criada como nova InternalNote após o
limite da transferência e está disponível ao destinatário com notes.read.
Supervisor com conversations.supervise **e** a permission de leitura correspondente
mantém histórico integral. REST e replay/live aplicam a política atual, inclusive
para eventos antigos e cursores emitidos antes da transferência.

conversations.transfer autoriza escolher o modo do histórico delegado ao novo
atendente; FULL pode liberar o histórico integral a esse destinatário. Esse poder
é explícito nessa permission, não inferido por nome do perfil.

## Permissions estáveis

- contacts.read / contacts.write
- conversations.read / conversations.create / conversations.archive
- conversations.assign / conversations.transfer / conversations.supervise
- messages.read / messages.send
- notes.read / notes.create
- tags.read / tags.manage

Bootstrap administrativo explícito instala conjuntos padrão: OWNER/SUPERVISOR
recebem todas; AGENT recebe todas exceto conversations.supervise e tags.manage.
tags.manage protege catálogo e vínculo/desvínculo de tags. Perfis customizados
podem distribuir permissions de outro modo. Nenhuma grant é feita no startup
ou em migrations; bootstrap não é executado em produção nesta entrega.
Supervisão de listas/histórico/replay é auditada. Auditoria usa ações e referências
mínimas, sem textos de mensagens/notas nem credenciais.

## REST e paginação

OpenAPI oficial: `openapi.json`. Todas as rotas permanecem em /api/v1; comandos
POST/PATCH/DELETE exigem Origin autorizado e CSRF vinculado à sessão. CORS inclui
esses métodos. Nenhuma origem de frontend é habilitada automaticamente.

Contacts: GET/POST /contacts; GET/PATCH /contacts/:id.
Conversations: GET/POST /conversations; GET /conversations/:id;
POST /conversations/:id/archive e /unarchive.
Messages: GET/POST /conversations/:id/messages;
POST /conversations/:id/messages/:messageId/status para recibos DELIVERED/READ.
Assignment/transfer: POST /conversations/:id/assign e /transfer.
Tags: GET/POST /tags, PATCH/DELETE /tags/:id;
POST/DELETE /conversations/:id/tags/:tagId.
Notes: GET/POST /conversations/:id/notes.
Sync: GET /realtime/events?lastEventId=0&limit=100.

Listas retornam items/nextCursor; limit padrão 50, máximo 100. Conversas têm
scope=mine (padrão), unassigned ou all (exige supervisão), archived=true,
tagId e contactId. GET Conversation inclui tagIds para reconciliar associações.

Cursores REST são opacos, assinados HMAC e vinculados a tenant/usuário/recurso/
filtros. Conversas ordenam por lastMessageAt DESC + id DESC; mensagens por
sequence DESC, usando before=nextCursor para histórico progressivo. Contacts e
Tags usam id ASC; Notes usam sequência do evento ASC. Não há OFFSET profundo.
O cursor não cria um snapshot: durante atualização concorrente da inbox, o
cliente reconcilia inserções/movimentos por ID e eventos realtime. A assinatura
não substitui autorização; toda página revalida acesso e visibilidade.

## Realtime e recuperação

Ver `REALTIME_CONTRACT.md`. WebSocket read-only integrado ao Fastify em
/api/v1/realtime, mesma sessão, Origin exato e contexto resolvido pelo servidor.
REST mantém comandos e CSRF. Nenhum JWT paralelo ou assinatura arbitrária de
tenant. Redis apenas notifica instâncias por canal do tenant; banco guarda eventos.
Payload é DTO de IDs, nunca cópia de mensagens/notas, e o cliente obtém conteúdo
por REST autorizado. Há checkpoints mesmo quando eventos são filtrados.

A sessão/contexto/permissions são conferidos antes da entrega e por guarda de
1 segundo. Logout e troca de contexto via REST aguardam invalidação dos sockets.
Revogação direta no banco fecha a conexão na próxima guarda (até ~1s mais latência
DB); operações e entregas posteriores revalidam acesso. A guarda não renova
inatividade: sessão ociosa expira normalmente, mesmo com socket aberto.

Limites M1: cinco sockets por sessão/instância, frames de entrada até 4KiB,
páginas de 100 eventos e backpressure de 1MiB por socket. Comandos no socket
fecham 1008. Cliente lento fecha 1013 e reconecta com checkpoint. Redis reconnect
reassina canais e sincroniza; reconciliação interna de 5s recupera commit cuja
notificação foi perdida. Isso não é polling frequente do cliente nem event bus
externo. Não há retenção/purge de eventos neste M1: todos persistem no banco.
