# Checkpoint 4 — sincronização limitada

Auditoria prévia: WHATSAPP_WEB_CHECKPOINT4_AUDIT.md. Nenhum segundo banco/modelo
de contatos ou mensagens. Baileys fica exclusivamente no adapter, fixado em
7.0.0-rc14. Demo preservado; Meta futuro usa o mesmo conteúdo canônico.

## Contrato e persistência

Extensão aditiva v1 `sync.batch`: até20 itens/64KiB, contatos, conversas ou
mensagens com identidade externa/aliases e conteúdo canônico existente. Sender
CONTACT/DEVICE; mensagens do celular não têm senderUserId nem prefixo de atendente
interpretado. Texto/caption original, transmittedBody distinto, timestamp original,
ID externo e UUID interno preservados. Mídia recebe somente referência determinística,
tipo/MIME/nome/tamanho/hash disponíveis e PENDING; sem binários, chaves, URL bruta,
download ou job de transferência. Capacidades de envio permanecem bloqueadas.

PN/LID normalizados sem supor telefone. Alias aceito somente de mapeamento explícito
do protocolo. Contatos com mesmo nome não se fundem; conflito entre identidades já
ligadas a contatos distintos gera falha parcial, sem destruir vínculos. Identificador
interno namespaceado por conexão evita misturar contas, e a UI mostra o externo.
Nome do provedor separado do nome manual. Atribuição, tags, notas, visibilidade,
status administrativo e atendentes não são sobrescritos.

Migration 20261010220000_whatsapp_web_bounded_sync acrescenta campos de progresso,
pairing, metadados, importedAt/historical, fronteira de histórico e recibos pendentes.
Substitui a unicidade por contato em ContactIdentity por índice não único para aliases;
PK/FKs/escopo org+canal permanecem. Não remove dados. Ordenação Web por timestamp/id
e cursor assinado; autorização ainda por sequência e importedAt/fronteira após
transferência LIMITED/NONE. Preview usa a mesma proteção. Demo usa cursor anterior.

SQL prefaz consultas por lote para identidades/conversas/IDs de mensagens. Transação
tenant/lease integra mensagens, Inbox e checkpoint; SAVEPOINT isola conflitos de
item, falha de infraestrutura desfaz lote e permite retry. Duplicata não aumenta
contadores. Recibos fora de ordem são monotônicos, buffer até256 por conexão, TTL7dias
validado/limpo nas próximas mutações. Não existe retenção ilimitada de recibos.

## Eventos e limites

Histórico: messaging-history.set/status, notificações de protocolo self-origin e
append autorizado. Contínuo: contacts/chats upsert/update, lid-mapping.update,
messages.upsert notify, messages.update recibos. requestId descartado; grupos e
broadcast permanecem fora da capacidade deste adapter. Recentes append até5min
podem recompor interrupção curta; catch-up antigo requer autorização histórica.
Não prometemos recuperar lacunas longas nem todo histórico do WhatsApp.

Journal normalizado criptografado/fsync preserva pending/checkpoints e retry ao
reiniciar. Staging até2000 itens/2MiB; histórico até1500 itens/1,5MiB reserva capacidade
para intake novo. Serial de memória até128 operações; sobrecarga contínua falha
explicitamente/fecha intake e readiness para impedir crescimento indefinido.
Limite por evento250 contínuos/1000 históricos; descartes são sinalizados como
parciais. Pull cria no máximo2 lotes de20/48KiB, até4 lotes históricos pendentes,
eventos novos têm prioridade; worker até2 conexões, sequência por conexão, retry5x
com backoff e dead letter. Falha histórica isolada não desativa intake novo.

Histórico por sessão/autorização: até500 identidades distintas (máximo500 contatos
e conversas novos), 500 eventos de contato/conversa e1000 mensagens, últimos30dias.
Limites cumulativos duráveis não resetam ao reiniciar. Leitor próprio limita input
comprimido1MiB, inflate8MiB/chunk, um download ativo, timeout15s; máximo16 notificações
e32MiB de saída aceita. SDK automático/full history desligado. O checkpoint de chunk
só avança após staging durável. Não armazenamos objeto SDK completo.

Logs estruturados somente código/duração/volume/committed, sem auth, JID, conteúdo
ou QR. Métricas do journal incluem pending/dead/syncDead/syncQueued. UI mostra
contadores SQL reais e backlog; estado CONNECTED independe da sincronização. Total
desconhecido não vira percentual. Limite, falha e ausência de histórico são distintos.

Histórico emite conversation.history.updated por conversa/lote e contacts.updated
agregado, sem message.created por item histórico. Realtime mantém persistência/replay/
revalidação/RBAC. Stream contacts-only exige contacts.read e não revela conversas;
stream normal conserva autorização por conversa e messages.read.

## Operação e privacidade

Deploy autorizado do CP4 usa PROVIDER_SYNC_ENABLED=true e PROVIDER_HISTORY_ENABLED=false.
Não faz logout, disconnect, refresh, fetchMessageHistory, re-pair ou envio automático.
Histórico só é permitido com flagtrue E PROVIDER_HISTORY_APPROVED_SCOPE exatamente
organizationId:connectionId, após estimativa e autorização operacional explícita.
Não existe botão que dispara importação irrestrita. Não ativar esse flag neste deploy.

Estimativa máxima: 500 identidades/conversas,1000 mensagens até8000 caracteres,
metadados de mídia sem bytes; conteúdo UTF-8 até32MB teóricos no SQL mais índices/
auditoria/realtime, com fila2MiB e inflate8MiB. A carga sintética específica mede
desempenho; não extrapolar SLA real. Fonte pode não reenviar histórico após CP3:
aguardar notificação autorizada, ou avaliar busca limitada com anchors em etapa
operacional específica; novo pareamento exige autorização e nunca é automático.

Minimização, isolamento e acesso seguem SECURITY_PRIVACY.md. Janela de30dias limita
admissão, não apaga dados existentes nem substitui política de retenção da organização.
Exclusão/consentimento/retenção administrativa continuam nas políticas existentes;
não presumir conformidade legal integral só com este checkpoint. Backups criptografados
e chaves ficam restritos em homelab/backups, evidências sem conteúdo pessoal.

Rollback preferencial mantém imagem CP4/parser compatível com eventos duráveis,
desativa sync/history e preserva auth, journal e migration. CP3 não entende sync.batch:
nunca voltar Provider CP3 com batches pendentes; não restaurar snapshot antigo sobre
sessão ativa sem autorização. Imagens CP3 retidas para rollback após drenagem e
validação de compatibilidade. Não executar down -v ou migration destrutiva.

Gates e relatório final, imagens, backup restaurado, CI, carga e health serão
registrados no deploy-records/wapphub-provider-web/20261010-checkpoint4.
Homologação no navegador pertence ao usuário; nenhum browser no Homelab, CP5 bloqueado.
