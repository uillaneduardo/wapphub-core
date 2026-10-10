# WhatsApp Web — Checkpoint 3

Core é a única API acessível pelo Chat. A integração continua opcional
(`PROVIDER_WEB_ENABLED=false` por padrão). Quando habilitada, API e Worker recebem
`PROVIDER_WEB_URL=http://provider-web:3000` e o secret de autenticação interna em
`PROVIDER_WEB_KEY_FILE=/run/secrets/provider_web_key`. Baileys permanece no pacote
isolado do provider, exatamente 7.0.0-rc14, com Node 22.23.3 e lockfile existente.

## Conexões e acesso

`providers.manage` efetiva, Membership/Organization ativos, sessão selecionada e
CSRF/Origin existentes protegem todas as operações. Nenhum papel/permissão padrão
foi alterado. Uma conexão por Organization reutiliza o Channel WHATSAPP_WEB.

- GET `/api/v1/providers/whatsapp-web/connections`: conexão atual ou null.
- POST no mesmo caminho, `{commandId}`: provisionamento idempotente e ocioso.
- POST `/:id/commands`, `{commandId,action,expectedVersion}`: connect, refresh ou
  disconnect. Apenas connect/refresh explicitamente solicitados iniciam um socket.
  Disconnect executa logout, revogando o vínculo e preservando o histórico.
- GET `/:id/qr`: QR temporário, revision/expiresAt/expiresInMs, no-store/private.
  Revalida a autorização e geração depois da resposta remota; QR não persiste no
  banco, auditoria, realtime, logs ou browser storage.
- WebSocket `/api/v1/providers/realtime` e replay GET
  `/api/v1/providers/realtime/events`: IDs apenas, providers.manage, incluindo
  administradores sem conversations.read. Usa o gateway/session guard existente.

Os estados internos QR_REQUIRED/FAILED/LOGGED_OUT são apresentados como
QR_READY/ERROR/DISCONNECTED. Comandos pendentes ficam separados dos estados reais.
Versões concorrentes e um comando pendente por conexão evitam ações conflitantes.
Worker reautoriza o ator/sessão antes de cada comando; retries idempotentes limitados
em cinco tentativas. Lease de banco com fencing impede dois consumidores de escrever
pela mesma conexão. Erros de processamento são códigos genéricos, sem conteúdo.

## Persistência e mensagens

Migration `20261010170000_whatsapp_web_core_integration` é aditiva:
ProviderConnection (estado/metadados/lease), ProviderCommand (outbox administrativo),
ProviderInbox (dedup/hash/IDs), Message.transmittedBody/providerOccurredAt opcionais.
Sem mudança em migrations antigas, RBAC, Meta ou Platform. Backup e restauração
isolada são necessários antes do migrate deploy de produção; nunca db push.

Worker consome o journal CP2 por pull/ack/nack autenticado. Resolve identidades,
Contact/Conversation no Core e persiste texto + inbox + eventos numa transação com
o mesmo lock por Organization do Chat. Ack só após commit; repetição após falha
não duplica mensagens. Payload bruto não é persistido. Inbound atribui Contact;
eco do aparelho tem origem DEVICE, sem atribuir um atendente. Recibos atualizam
status monotonicamente. Conteúdo original é preservado exatamente; apresentação
transmitida usa campo separado. Histórico/atribuição/visibilidade M1 permanecem.

Envio pelo Chat está **bloqueado pelo backend** (PROVIDER_SEND_UNAVAILABLE) e pela
capacidade outboundEnabled no DTO. Não há implementação comercial de envio.
Nenhuma conta ou sessão real é criada/conectada automaticamente pelo deploy.

## Multimídia: dependências ainda abertas

Contrato CP1 já define IMAGE/AUDIO/VOICE/VIDEO/DOCUMENT, referências UUID, MIME,
tamanho máximo 25 MiB, hash, thumbnail e estados PENDING/TRANSFERRING/READY/FAILED.
Provider CP2/3 anuncia somente TEXT e não baixa/transmite arquivos. O Core atual
não tem armazenamento/Media com ACL por conversa, upload autenticado, Range,
miniaturas ou jobs de transferência. Esses componentes deverão preceder ativação
de capacidades/controles de mídia. Não há Base64 nem arquivo no barramento ou WS;
texto tem fila/consumo independente. Nenhuma gravação/captura é anunciada como pronta.

## Operação e recuperação

Core health continua dependente de DB/Redis, preservando Demo em falha do provider.
Worker health verifica DB/Redis e heartbeat do processo; erros do provider não
inviabilizam toda a API. Provider permanece apenas nas redes backend/egress, sem
ports/ingress, rootfs read-only, vault criptografado e writer lock CP2.

Rollback antes de homologação: interromper Worker novo, desabilitar integração na
API/Chat, restaurar imagens anteriores e provider ALLOW_SESSION_CONNECT=false sem
remover volumes/segredos. Migration aditiva deve permanecer; não fazer DDL inversa.
Se houver vínculo após ação humana, não trocar provider sem preservar/desabilitar
sessões e avaliar compatibilidade do histórico Web com Chat anterior. Não excluir
mensagens, inbox, comandos ou credenciais como mecanismo de recuperação.

Homologação manual: em https://chat.wapphub.com.br/app/settings/providers, criar
conexão, solicitar QR, conferir expiração/renovação/estados/avisos e desconexão.
Escanear e autorizar um aparelho é exclusivamente uma decisão/ação humana.
Envio pelo Chat e multimídia continuam pendentes, mesmo se o vínculo for aprovado.

Overlays versionados: Core `compose.provider-web.yml` (CORE_IMAGE e arquivo do
secret existente); provider `compose.chat-integration.yml` explicitamente permite
novas conexões por comando. Base Compose mantém connect desabilitado. Atualização
somente de serviços alvo com --no-deps, sem down ou restart de DB/Redis.
