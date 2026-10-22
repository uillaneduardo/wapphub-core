# Política de atendimento: AGENT por atribuição (2026-10-22)

## Regra

- **AGENT** permanece em espera e enxerga apenas `scope=mine` (conversas atribuídas ao próprio `userId`).
- `scope=unassigned` e `scope=all` retornam 403 para AGENT, incluindo consultas diretas por URL.
- Conversas não atribuídas ou atribuídas a terceiros retornam 404 para AGENT, em leitura de detalhes, mensagens, mídias, notas, envio, atualização de status e recursos mediados por `Chat.conversation()`.
- O Core nunca entrega eventos de mensagens não autorizadas ao AGENT; a transferência invalida o antigo responsável sem revelar conteúdo.
- O AGENT não pode iniciar conversas, autoatribuir, atribuir ou transferir; deve aguardar ação de OWNER/SUPERVISOR com as permissões operacionais apropriadas.
- A atribuição/transferência respeita a autorização e validação do receptor e a política de visibilidade de histórico (FULL/LIMITED/NONE).
- A lista de contatos pode continuar disponível de acordo com `contacts.read`; ela não concede histórico de conversas.

## Segurança e permissões

`resolvePermissions` remove de forma impositiva, para o role **AGENT**, `conversations.create`, `conversations.assign`, `conversations.transfer` e `conversations.supervise`, mesmo que haja registros antigos herdados ou concessões via override. Novas tentativas de GRANT desses recursos para um membro AGENT são rejeitadas.

Esse teto por role é deliberado: permissões determinam o que o agente pode fazer **dentro das conversas atribuídas**, mas não substituem o vínculo de atribuição persistido no Core.

Não é necessária migration; não há alteração de schema nem de volumes. Atualizar Core API/Worker e Chat. O Provider não precisa ser recriado para essa mudança.

## Homologação

1. Login AGENT sem conversas atribuídas: inbox `Minhas` vazia; sem aba `Não atribuídas`, `Todas` ou `Nova conversa`.
2. GET/POST direto para conversa não atribuída: negado, sem mensagens nem mídia.
3. OWNER/SUPERVISOR atribui: AGENT recebe atualização realtime, lê o histórico autorizado e pode responder, se possuir `messages.read`/`messages.send`.
4. OWNER/SUPERVISOR transfere a outro membro: agente anterior deixa de ter acesso, inclusive por URL.
5. Tentativa do AGENT de atribuir a si, criar conversa ou obter privilégios via override: negada.
