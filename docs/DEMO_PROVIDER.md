# Demo Provider (branch M1)

## Estado

Implementação local em `feat/m1-demo-provider`, ainda não integrada nem publicada. As migrations aditivas foram aplicadas apenas ao Compose isolado `wapphub-m1-test` / banco `wapphub_m1_test`. Não houve alteração de produção.

O Demo Provider exercita o domínio comum de canais. Ele não chama serviços externos e não implementa Meta, mídia, billing ou convites.

## Arquitetura

`MessagingProvider` define `sendText` e normalização de entrada. `DemoProvider` é o adaptador determinístico e sem rede externa. `MessageIngestionService` persiste a mensagem recebida na tabela `Message` existente; depois o serviço de Chat atualiza a conversa, auditoria e evento `message.created`. Não há segundo armazenamento de mensagens.

Fluxo de entrada: simulador autenticado → endpoint DEMO → adaptador → identidade de contato resolvida no tenant → serviço de ingestão → `Message`/`Conversation` → evento realtime persistido e publicado.

Fluxo de saída: atendimento → `POST /conversations/{id}/messages` → serviço de Chat → `MessagingProvider.sendText` → mesma tabela `Message` como OUTBOUND. O adaptador confirma entrega simulada localmente; não há recibos DELIVERED/READ remotos.

## Modelo

- `Channel` guarda o estado por Organization/provider, com unicidade tenant + provider.
- `ContactIdentity` liga o identificador externo estável do Demo a um Contact e Channel dentro da Organization.
- `Conversation.channelId` e `providerConversationId` identificam o canal e a conversa externa; chaves externas não dependem de nome ou telefone.
- `Message.direction` aceita `INTERNAL`, `INBOUND` e `OUTBOUND`; `senderUserId` identifica atendente e `senderContactId` identifica contato. Entrada nunca usa Owner como remetente.
- `providerMessageId` tem unicidade tenant/channel e é usado para idempotência do provedor. Mensagens M1 antigas conservam direção INTERNAL e clientMessageId.

Na primeira ativação, dois contatos, duas conversas e duas mensagens recebidas são provisionados transacionalmente com identificadores estáveis. Reativar não duplica recursos. Desativar preserva o histórico e bloqueia novas entradas e respostas.

## API e autorização

| Método | Endpoint | Permission | Uso |
|---|---|---|---|
| GET | `/api/v1/providers` | `providers.manage` | Catálogo e estado da Organization atual |
| PUT | `/api/v1/providers/demo` | `providers.manage` + CSRF | Habilitar/desabilitar e provisionar idempotentemente |
| GET | `/api/v1/providers/demo/contacts` | `providers.simulate` | Contatos/conversas disponíveis no simulador |
| POST | `/api/v1/providers/demo/messages` | `providers.simulate` + CSRF | Ingerir texto como contato autenticado |

O servidor resolve Organization da sessão e o contato pelo vínculo tenant/channel. O browser não envia senderUserId nem organizationId. `providers.manage` e `providers.simulate` são concedidas ao OWNER pelo bootstrap RBAC; nomes de role não são usados nas verificações HTTP.

As mensagens utilizam os endpoints M1 existentes de histórico/envio e eventos realtime já documentados. O simulador também precisa de `messages.read` para consultar o histórico pela API normal. Conteúdo não vai no envelope realtime. Status de entrega/leitura externos não são apresentados.

## Homologação e limites

Executar somente com `scripts/m1-test.sh` e configuração `NODE_ENV=test`/database `_test`. A suíte verifica ativação, permissionamento, tenant, autoria, idempotência, preservação/bloqueio ao desativar e WebSocket nos dois sentidos. A UI de homologação é `/app/providers/demo/simulator`.

Para integrar futuramente outro canal, implementar o port `MessagingProvider`, mapear identidades externas tenant-scoped e usar a ingestão normalizada. Este documento não declara nenhum adaptador Meta implementado. Meta aparece apenas como `IN_DEVELOPMENT` no catálogo da interface.
