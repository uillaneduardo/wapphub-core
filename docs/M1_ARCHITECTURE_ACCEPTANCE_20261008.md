# Auditoria arquitetural e aceite M1 — 2026-10-08

> Atualização de produção — 2026-10-08, 15:00 Recife: P0 publicado em Core/API/Worker
> `cbaf50c5eedd6731e1ca3a674c1d9b0b20005a7d` (`wapphub-core:p0-preview-cbaf50c`)
> e Chat `d93efc576bd560fcbab0146343fb98bbbc1d0b69` (`wapphub-chat:p0-preview-d93efc5`).
> Todos os cinco serviços healthy; HTTP, assets e integridade aprovados.
> Validação funcional isolada anterior reaproveitada: 58 Core + 91 Chat; não reexecutada.
> Homologação visual desta publicação pendente. A2 e demais aceites M1 permanecem;
> M1 não formalmente encerrado. M2/P1 não iniciados.
> [Registro de publicação e contingência](DEPLOY_P0_20261008.md).

## Registro histórico anterior à publicação P0

## Conclusão verificável

M1 é operacional em produção, inclusive Demo e melhorias de UI homologadas pelo
usuário. **Não pode ser formalmente encerrado nesta revisão.** Existem um defeito
de autorização de prévias e uma lacuna comprovada de checkpoint/aplicação de
eventos no Chat. A main remota também não preserva todas as revisões publicadas.
Esta execução revisou código/contratos e criou documentação; não corrigiu funções.

Referências obrigatórias preservadas: `MILESTONES.md`, `STATUS.md`,
`M1_CHAT_INTERNAL.md`, `M1_VALIDATION.md`, `REALTIME_CONTRACT.md`,
`DEMO_PROVIDER.md` e documentos M1 do Chat. MILESTONES/FEATURES/DOMAIN não foram
reescritos. Inventário completo: `GIT_PRODUCTION_INVENTORY_20261008.md`.

## Evidências e limites

- E1: inspeção da revisão Core 72d05aa e Chat 3e23452; fingerprint de 37 arquivos
  da imagem Core igual ao Git; label Chat e hashes públicos conferidos.
- E2: reexecução segura de lint, typecheck, **56 testes**, build e OpenAPI no
  container API **isolado** wapphub-m1-test, código idêntico ao Core publicado,
  NODE_ENV=test e banco wapphub_m1_test. Zero falhas na suíte existente.
- E3: reexecução de lint, typecheck, **86 testes em 16 arquivos**, build do Chat
  (Vitest/jsdom, API mockada). Zero falhas na suíte existente.
- E4: ledger das seis migrations somente leitura, checksums corretos, saúde dos
  cinco containers de produção e HTTP público/estáticos. OpenAPI público igual
  semanticamente ao docs/openapi.json local (28 paths REST documentados).
- E5: homologações informadas pelo usuário: envio/recebimento Demo, correções
  visuais de UI Polish, rolagem/compositor, UI Polish 3 e navegação Lucide.
  Isso valida operação reportada; não prova todas as permissões, multi-Organization,
  touch/leitor de tela ou cada viewport. Não inventar data/roteiro/artefato adicional.
- E6: contraprovas sintéticas: prévias com messages.read ausente/NONE em DB
  mockado e em REST com banco isolado; fila realtime/checkpoint sem rede/banco. Resultados registrados abaixo. Essas propriedades
  não são cobertas pelos testes existentes; 56/86 testes verdes não as refutam.
- E7: smokes históricos isolados e públicos descritos em M1_VALIDATION/DEPLOYMENT,
  inclusive dois tenants, duas sessões, replay e concorrência. São históricos,
  não testes mutáveis refeitos em produção nesta auditoria.

Logs de testes locais: /tmp/wapphub-core-reconcile-checks.log e
/tmp/wapphub-chat-reconcile-build.log; /tmp é temporário. Resultados e comandos
permanecem registrados aqui. Não foram executados migrations, seeds, login ou
mensagens de teste em produção. Nenhum browser gráfico foi instalado/executado.

## Matriz de entregas do M1

Classificações: **Implementado e validado**, **Implementado, mas sem evidência
suficiente**, **Parcial**, **Pendente**, **Fora do escopo**. Validação é sempre
limitada à evidência indicada; a linha não significa aprovação comercial/M5.

| Requisito original ou extensão documentada | Classificação | Evidência / limite |
| --- | --- | --- |
| Autenticação/sessão server-side/logout | Implementado e validado | foundation.ts; foundation.test.ts; Chat sessão/Sidebar; E2/E3/E5/E7 |
| Organizations/Memberships/RBAC | Implementado e validado | Foundation.membership/select, Chat.context; negativos de estados/permissões; E2 |
| Contacts Core CRUD tenant-scoped | Implementado e validado | Chat.contacts/saveContact; testes CRUD/constraints/cursor; E2 |
| Contacts UI listar/criar/editar | Pendente | app/App.tsx usa PlaceholderPage; SCOPE do Chat requer CRUD; não inferir conclusão de HTTP 200 |
| Conversations Core/criação | Implementado e validado | createConversation; testes filtros/create/negativos; E2/E7 |
| Criação manual de conversa no Chat | Parcial | Core cria e Demo provisiona; Inbox não tem comando criar e chatApi não tem createConversation |
| Messages internas/TEXT/status locais | Implementado e validado | Chat.send/messageStatus; recibos monotônicos; E2/E3 |
| clientMessageId/idempotência principal | Implementado e validado | unique tenant/conversation/key, conflitos/concorrência; otimista/retry principal; E2/E3 |
| Tags/vínculo operacional | Implementado e validado | Core CRUD e vínculos; contexto Chat aplica/remove/filtro; E2/E3 |
| Catálogo Tags UI | Parcial | rota Tags é placeholder; aplicar tags existentes funciona; não é nova exigência de M2 |
| Notes | Implementado e validado | Core/Chat create/list, limites REST/replay; E2/E3 |
| Archive/unarchive | Implementado e validado | Core e ConversationActions; E2/E3/E7 |
| Assignment manual/equipe elegível | Implementado e validado | roster publicado/RBAC; UserSelect; testes destinatário/permissão; E2/E3 |
| Transferência FULL/LIMITED/NONE integral | Parcial | messages/notes/replay testados; prévia lastMessagePreview ignora autorização/limite (A1) |
| Supervisão | Implementado e validado | permission conversations.supervise + leitura correspondente; auditoria e testes; ressalva A1 |
| AuditEvent/SecurityEvent | Implementado e validado | domínio+evento+audit transacionais; auth SecurityEvent; mínimos sem texto/segredos; E2 |
| REST + WS/eventos tenant-scoped Core | Implementado e validado | sessões/Origin/contexto, guardas, audienceUserId, replay; E2/E7 |
| Realtime cliente/reconexão/sincronização completa | Parcial | transporte/dedup/checkpoint implementados; bus não aguarda REST e fila antiga pode emitir após close (A2) |
| Cursor pagination | Implementado e validado | cursores HMAC/scope e sequence; inbox/histórico; E2/E3; não representa snapshot estático |
| UI otimista e retry Chat | Implementado e validado | conversationModel + ConversationView; retry mesma chave; E3/E5 |
| Bootstrap/API versionada/erros/OpenAPI | Implementado e validado | /api/v1/app/bootstrap; AppError; schemas formais e OpenAPI público; E2/E4 |
| Frontend com rotas reais/fallback | Implementado e validado | BrowserRouter/Nginx; HTTP login/deep route e hashes; E3/E4; placeholders não contam como telas completas |
| UI por permissions | Implementado e validado | Guards/ConversationActions; menus e comandos negados; E3; backend continua autoridade |
| Seleção/troca Organization ponta a ponta | Implementado, mas sem evidência suficiente | endpoint/guards/desmontagem e teste detalhe; falta aceite integrado de duas Organizations/atrasos; A2 aumenta risco |
| Baseline visual/tokens/responsividade | Implementado e validado | E3/E5; sem confirmação exaustiva de cinco viewports/touch/leitor de tela |
| Scroll/compositor/desabilitados/IME/duplicação | Implementado e validado | hooks/Conversations/tests; E3/E5 |
| Menu recolhível/Lucide/flyout/logout | Implementado e validado | AppIcon/Sidebar, 22px/traço2/44px; E3/E5 |
| Painel redimensionável/preferências por conta | Implementado e validado | useContextPanel/useUiPreference/SendPreference; E3/E5 |
| Demo/port MessagingProvider/ingestão | Implementado e validado | mesmo Message/Conversation/stream; tenant/identidade/idempotência; E2/E5 |
| Retry da UI Demo após confirmação incerta | Parcial | backend idempotente, mas simulador gera externalMessageId novo a cada tentativa (A3) |
| Entitlements/convites comerciais/Admin/Minha Conta | Fora do escopo | M2, não inferir do schema Invitation ou placeholder |
| Meta real/mídia/Outbox/Inbox externo | Fora do escopo | M3/M4; Demo determinístico não é integração externa |
| Performance 100 agentes/restore validado/MVP comercial | Fora do escopo | M5; testes básicos de concorrência e gzip não provam esses aceites |

## Critérios obrigatórios de MILESTONES.md

| Critério M1 | Classificação | Veredito |
| --- | --- | --- |
| Organizations permanecem isoladas | Implementado e validado | Core REST/FKs/WS negativos E2/E7; não há contraprova cross-tenant backend |
| Multi-Organization alterna sem vazamento visual/realtime | Implementado, mas sem evidência suficiente | guardas/remoção de contexto implementadas; E3 testa detalhe; A2 fila antiga é risco reproduzível, falta teste integrado |
| Conversa criada/atribuída/transferida/tageada/anotada/arquivada | Parcial | domínios e controles de operações testados; transferência não protege prévia A1; CRUD/criação manual UI incompletos |
| Duas sessões observam realtime coerente | Parcial | Core comprovado E2/E7 e Demo E5; frontend pode confirmar antes de aplicar REST A2 |
| Queda/reconexão não perde estado persistido | Parcial | Core durável/replay E2/E7; banco não perde, mas atualização da UI pode se perder A2 |
| Refresh em rota profunda funciona | Implementado e validado | Nginx fallback/HTTP200 com HTML exato da imagem; E4; renderização manual E5 |

## Achados priorizados

### A1 — P0, conteúdo da prévia não respeita autorização/histórico

`src/application/chat.ts:43` (conversationDTO) retorna `r.messages[0].body`.
`conversation` (:218) e `conversations` (:357, include :404) buscam a última
Message sem exigir messages.read nem aplicar visibleFromMessage. A API /messages
faz essas duas verificações. Após transfer NONE, a última mensagem anterior
continua sendo selecionada e exposta no DTO da conversa; também ocorre para
leitor com conversations.read sem messages.read. Tenant não muda, mas conteúdo
não autorizado dentro do tenant é exposto. Endpoint GET pode alimentar UI com
esse corpo mesmo quando o histórico está vazio/negado.

Harness em Node contra Chat compilado do ambiente isolado, com **DB mockado**,
principal/linha sintéticos e somente conversations.read, visibility=NONE,
visibleFromMessage=10, messages=[{body:'SYNTHETIC PRIOR MESSAGE'}]:

```json
{"visibility":"NONE","hasMessagesReadPermission":false,"messagesEndpoint":403,"detailPreview":"SYNTHETIC PRIOR MESSAGE","inboxPreview":"SYNTHETIC PRIOR MESSAGE"}
```

Repro adicional confirmado em **REST real com fixtures sintéticas no banco
wapphub_m1_test**, via Fastify.inject e mesma revisão de código. Criou-se tenant,
duas identidades/Memberships, roles com permissions mínimas, sessão sintética,
Contact/Conversation e Message anterior. Executou-se Chat.assign com transfer
NONE; GETs autenticados de inbox/detalhe/histórico e remoção de messages.read no
role sintético produziram:

```json
{"scenario":"real isolated REST after NONE transfer","detailStatus":200,"detailPreview":"SYNTHETIC HIDDEN PRIOR MESSAGE","inboxPreview":"SYNTHETIC HIDDEN PRIOR MESSAGE","visibleMessages":0}
{"scenario":"without messages.read","messagesStatus":403,"detailStatus":200,"detailPreview":"SYNTHETIC HIDDEN PRIOR MESSAGE"}
```

Fixtures removidas ao terminar (somente IDs/Organization sintéticos criados pelo
harness), conexões encerradas. Nenhum request autenticado com conteúdo real de
produção foi feito. A contraprova agora confirma ambos os casos independentemente,
não depende só de mock. Reproduzir em teste isolado com as mesmas permissões,
createConversation/send/transfer NONE, leitura dos três endpoints, depois negar
messages.read. Testes permanentes de regressão devem ser criados no PR de correção.

Confirma-se a diferença de policy. Correção futura: uma policy
única para conteúdo autorizado no histórico e nas prévias (incluindo supervisor
com permission de leitura), null quando não há mensagem visível; testes HTTP
para conversations/list/detail sem messages.read e após transfer NONE/LIMITED.
Revisar minimização de outros DTOs que transportam conteúdo. Não alterar só a UI.
É bloqueador obrigatório de encerramento M1 e prioridade antes de novo trabalho
funcional M2. Correção e deploy requerem execução separada autorizada.

### A2 — P1, checkpoint é confirmado antes de aplicar atualização REST

Chat `AppShell` passa realtimeBus.emit como onEvent; bus chama listeners
síncronos com assinatura void. Inbox/Conversations/Providers iniciam requests
com void e capturam erros. RealtimeClient aguarda o retorno void, registra seen
e confirma o próximo checkpoint sem aguardar a leitura REST. Se a leitura falha,
reconnect retoma após o evento perdido; não existe resync geral garantindo a UI.
A deduplicação pode ainda impedir reaplicar um evento falho na mesma instância.

Contraprova Node local, TypeScript transpilado em memória, FakeSocket e listener
que aguarda Promise controlada, sem rede/banco/browser:

```json
{"checkpoint":"1","downstreamApplied":false}
{"eventsDispatchedAfterClose":1}
```

Segundo caso enfileira um evento e chama close antes do próximo microtask;
handleFrame não checa closed/geração. Pode emitir pelo bus global após troca de
contexto/logout. O cliente filtra pelo tenant antigo da instância, mas Inbox e
Demo não repetem filtro de Organization no listener. Guards desmontam o shell,
porém isso não é prova de cancelamento de eventos/requests já enfileirados.
Não foi comprovado vazamento cross-tenant de corpo; backend segue negando IDs.

Correção futura pequena/revisável: protocolo de aplicação assíncrona ou marcação
de resync necessário, checkpoint só após sucesso, geração/cancelamento no close
e limites de dedup; testes falha REST, reconnect e troca de contexto com eventos
atrasados. Evitar refatoração ampla e polling frequente. Bloqueador de aceite de
reconexão/coerência; revisão antes de encerrar M1.

### A3 — P2, diferenças Demo/Chat e autoria apresentada

Demo send cria UUID em cada tentativa e restaura draft após erro; retry após
commit com resposta perdida pode duplicar mensagem. Não compartilha otimista,
retry, paginação ou ancoragem do Chat; carrega só a última página de 50 mensagens.
Não afirmar equivalência de compositores inteiros.
Conversations mostra session.user.name para qualquer OUTBOUND, mesmo de outro
atendente. Autoria persistida continua correta em senderUserId, mas rótulo pode
atribuir incorretamente mensagem histórica ao usuário atual. Corrigir/validar em
trabalho próprio; não redesenhar componentes nesta auditoria.

### A4 — P2, UX/documentação e integração incompletas

Contacts, catálogo Tags, Equipe e configurações gerais são placeholders.
CRUD de Contacts é escopo expresso do frontend SCOPE; criação manual de conversa
não está exposta. Distinguir ausência de UI de endpoints funcionais. Até conferir
critério ponta a ponta, não chamar frontend inteiro de completo. Plano M2 não
pode absorver silenciosamente lacunas M1. Integração Git pendente também precisa
ser revisada para garantir fonte de produção recuperável.

### A5 — risco operacional, não novo critério de M1

Backup pré-Demo existe (19.689 bytes), gzip íntegro, permissão 600, mesmo host,
sem evidência de criptografia/restore. Documento Demo recomendava ensaio/backup
criptografado antes de publicar; essa exigência operacional não foi demonstrada.
Backup pré-M1 (10.192 bytes) também íntegro. Não realizar restore/downgrade agora.
Core sem revision label e override /tmp fragilizam rastreabilidade. Benchmark
M5 não foi feito. Analisar antes de expansão comercial sem alterar roadmap.

## Mapa arquitetural Core

Foundation resolve identidade/sessão/Membership; Chat.context revalida contexto
em cada operação; mutation bloqueia a linha Organization e revalida autorização
em transação READ COMMITTED. Repositório Prisma é usado no application service,
controllers Fastify validam DTOs finos. Command+AuditEvent+RealtimeEvent são
atômicos; pub/sub Redis só acorda stream persistente. Sequência de tenant por
lock é simples/consistente, mas precisa medição em M5.

Transferência persiste limites, não copia/deleta mensagens/notas. A1 mostra que
policy deve abranger também prévias. Cursores assinados vinculam filtros/tenant/
usuário, não substituem autorização. Gateway guarda sessão/permissions/contexto
por entrega e a cada segundo; frames só IDs e comandos REST com CSRF.
Logs usam códigos/requestId, não corpos. Worker mantém conexões/health e não
processa jobs Meta; nenhuma fila externa operacional no M1.

DemoProvider implementa sendText/parseInbound determinísticos, sem rede.
MessageIngestionService grava no Message comum; Chat emite mesmos eventos/audit.
INBOUND deriva ContactIdentity tenant/channel, senderContactId, senderUserId=null;
OUTBOUND deriva Principal.user, senderUserId e senderContactId=null. Payload HTTP
não admite autor/tenant arbitrário. Uma sessão de atendente autoriza o simulador,
mas **não se torna identidade externa**. O simulador é ferramenta autenticada,
não login público de contato externo. Meta permanece IN_DEVELOPMENT.
O port atual usa chamada síncrona dentro de transação: funciona para Demo sem
rede, mas M3 precisa Outbox/Inbox e revisão do port; não extrapolar para Meta.

## Próximos passos autorizáveis

1. Revisar/corrigir A1 e cobrir previews/visibilidade como parte de M1.
2. Corrigir A2 com testes de falhas/concorrência e resync do cliente.
3. Concluir/clarificar escopo M1 de Contacts/criação e executar roteiro integrado
   multi-Organization/realtime; registrar cada aceite e atualizar STATUS.
4. Integrar revisões publicadas por PRs pequenos, mantendo commits existentes.
5. Encerrar formalmente M1 só após resolver obrigatórios. M2 pode ser planejado
   agora, mas sua implementação deve aguardar essa barreira de qualidade.
