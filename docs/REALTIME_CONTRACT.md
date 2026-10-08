# Contrato realtime — M1, versão 1

M0 reservou este envelope; o M1 backend o implementa sem alterar seus campos.

## Handshake e escopo

`GET /api/v1/realtime?lastEventId=0` com upgrade WebSocket, Origin autorizado e
cookie da sessão existente (wapphub_session em teste/desenvolvimento,
__Host-wapphub_session em produção). Nenhum token em URL. Nenhum organizationId
aceito; tenant vem do Organization Context da sessão, com User/Organization/
Membership ativos e conversations.read. O socket só recebe eventos autorizados.

Conexão fixa contexto e sessão. Troca de contexto encerra o socket com 1008;
cliente descarta cache/cursor do tenant anterior e abre nova conexão com cursor
próprio do novo tenant (ou 0). Não reutilizar lastEventId entre organizações.
Mensagens enviadas pelo cliente no socket são rejeitadas; comandos usam REST/CSRF.

## Envelope operacional

```json
{
  "version": 1,
  "eventId": "42",
  "organizationId": "uuid",
  "type": "message.created",
  "entityId": "uuid",
  "occurredAt": "2026-10-08T00:00:00.000Z",
  "payload": {"resourceId": "uuid", "conversationId": "uuid"}
}
```

IDs sequenciais BigInt são strings decimais; não converter para Number.
Ordem é crescente no stream de cada tenant, com lacunas permitidas. payload
carrega só IDs; não inclui conteúdo, ORM, tokens, IPs ou credenciais.
entityId/resourceId identificam o recurso; conversationId identifica o escopo
quando aplicável. Corpo/estado atual são consultados via REST autorizado.

| Evento | entityId | Permission/escopo de entrega |
|---|---|---|
| conversation.created | Conversation | conversations.read + acesso atual |
| conversation.updated | Conversation | idem; inclui unarchive e novo lastMessageAt |
| conversation.archived | Conversation | idem |
| conversation.assigned | Conversation | idem |
| conversation.transferred | Conversation | idem; reconciliar/resetar histórico conforme nova visibilidade |
| message.created | Message | messages.read + Conversation + limite do histórico |
| message.updated | Message | idem; recibos locais |
| note.created | InternalNote | notes.read + Conversation + limite das notas |
| tag.created / tag.updated / tag.deleted | Tag | tags.read + tenant |
| conversation.tag.added / conversation.tag.removed | Tag | tags.read + acesso à Conversation |

Exclusão de Tag emite remoções de seus vínculos antes de tag.deleted.
Transferência aplica FULL/LIMITED/NONE também a eventos antigos; não basta
filtrar Organization. Supervisor precisa das permissions de recurso para
bypassar o limite. Antigo atendente recebe somente a invalidação mínima conversation.transferred
(IDs) pelo escopo de usuário, para remover o cache; não recebe conteúdo nem
novas mensagens da Conversation, exceto com supervisão. Clientes devem invalidar o cache ao mudar atribuição;
conteúdo recebido anteriormente não pode ser apagado remotamente pelo servidor.

## Checkpoint, reconnect e sync

Servidor envia um frame de controle após cada página escaneada:

```json
{"version":1,"type":"sync.checkpoint","lastEventId":"42","hasMore":false}
```

Checkpoint avança também sobre eventos não visíveis, sem revelar seus IDs/
recursos individuais. Cliente persiste o último checkpoint por Organization e
só o confirma após aplicar os eventos precedentes. hasMore=true indica outra
página automática no WebSocket. Conectar sem cursor inicia replay em 0.

Alternativa REST: `GET /api/v1/realtime/events?lastEventId=42&limit=100` retorna
`{events,lastEventId,hasMore}` sob a mesma autorização. Consumir páginas até
hasMore=false; usar esse checkpoint na reconexão. Não usar polling frequente
como transporte principal. Depois de mudança de visibilidade, refazer as
consultas de histórico para reconciliar o conjunto permitido.

Eventos persistidos e mudanças de domínio compartilham transação. Redis pub/sub
em wapphub:realtime:{organizationId} envia só sinal de atualização, sem storage
primário. Cada socket tem fila serial de sync; cliente deve deduplicar por eventId
para retries/reconexões (entrega não é exactly-once). Guardas de sessão e
reconciliação após reconnect Redis/notificação perdida estão em M1_CHAT_INTERNAL.md.

Mensagens Demo recebidas e respostas do atendimento emitem `message.created` e
`conversation.updated` pelo mesmo fluxo. O envelope continua contendo somente
IDs; o histórico M1 autorizado resolve direction, autor e conteúdo via REST.

Códigos de encerramento: 1008 para sessão/contexto/permissão inválidos ou comando
não suportado; 1013 para limite/backpressure. Falhas não expõem detalhes internos.
Retenção não é aplicada neste M1; eventual compactação exigirá contrato de
resync/bootstrap e não pode apagar eventos silenciosamente.
