# P0 — Autorização de prévias de mensagens

## Estado e base

Correção **local**, branch `fix/m1-message-preview-authorization`, baseada na
reconciliação Core99ef04b (código funcional Core72d05aa). Chat parte de 6b30266
(código funcional3e23452). Reconciliação, PRs documentais e branches anteriores
preservados. Não houve push, merge, deploy, migration ou início funcional de M2.
Produção continua em Core72d05aa/Chat3e23452 e **ainda contém o defeito** até uma
publicação especificamente autorizada. M1 não é encerrado: A2/realtime permanece.

## Causa raiz e superfícies examinadas

List/detail selecionavam a última Message com body e conversationDTO copiava
body para lastMessagePreview sem messages.read nem visibleFromMessage.
conversations.read autoriza metadados/acesso à conversa, não conteúdo.
FULL/LIMITED/NONE já eram aplicados no /messages e no replay, mas não na prévia.
Supervisor sem messages.read também recebia conteúdo indevido.

| Superfície | Resultado da revisão/correção |
| --- | --- |
| GET /conversations (todas as abas/filtros/páginas) | DTO exige contexto; prévia somente com leitura e sequência autorizada |
| GET /conversations/:id | Mesma policy; sem messages.read não consulta Message para prévia |
| Criação/archive/assign/transfer retornando Conversation | Mesmo DTO com contexto obrigatório; sem candidato de preview retorna null |
| GET /conversations/:id/messages | Permission + tenant/acesso + floor; paginação revalida policy |
| POST /messages/:id/status | messages.read e floor compartilhado; não retorna mensagem anterior ao limite |
| Envio/retry INTERNAL/OUTBOUND e entrada Demo | Respostas confirmam texto fornecido pelo próprio comando autorizado; autor/conteúdo/chave são revalidados, não leitura indireta de outro conteúdo |
| WebSocket e /realtime/events | Somente IDs, permission/floor compartilhado; nenhuma prévia ou corpo no envelope |
| Notes | Contrato separado notes.read/create e visibleFromEvent; não é resumo automático de mensagens |
| Search/resumos/contadores | Não existem APIs de busca textual/resumo/contagem de conteúdo neste M1; inbox count é quantidade de conversas carregadas |
| lastMessageAt/contactName/provider/tagIds | Metadados sob conversations.read/acesso; nenhuma derivação textual de Message fora da prévia identificada |

MessageDTO só é usado nos caminhos de mensagens/recibos/envio/ingestão acima.
Bootstrap, providers/catalog, Demo contacts e roster não retornam body ou resumo
de mensagens. Audit/realtime não carregam texto; erros continuam code/requestId.
Não confundir permission para metadados com permission para leitura de mensagens.

## Implementação

`src/application/chat.ts` centraliza messageReadFloor: tenant do contexto deve
coincidir com o da Conversation e messages.read deve existir; supervisor com
messages.read usa floor0; demais usam visibleFromMessage persistido. Essa policy
é usada por preview, histórico, recibos e eventos de mensagem.

conversationDTO agora recebe contexto obrigatório, preservando formato público.
O candidato mais recente inclui sequence internamente. Seu body só é serializado
quando sequence>=floor; senão lastMessagePreview=null. Como a sequência é ordenada,
se a mais recente está abaixo do limite nenhuma outra mensagem pode ser visível.
Não há N+1 adicional, query por mensagem individual ou alteração de ordenação.
Sem messages.read, include de mensagens fica false. Consulta interna conversation
não carrega mensagens por padrão; comandos/realtime buscam só metadados. Apenas
GET detail solicita preview, e list usa a mesma política contextual no DTO.

FULL mantém histórico autorizado; LIMITED mantém últimas N e futuras; NONE
retorna null antes da primeira mensagem nova e depois mostra a nova autorizada.
Supervisor não bypassa messages.read. Tenant, elegibilidade de assignee, cursor,
Origin/CSRF, audit e erros existentes são preservados. sequence/floor não passam
a integrar o DTO público.

Chat `InboxList` tem defesa adicional: não renderiza prévia sem messages.read,
inclusive resposta legacy/cache/realtime. Não decide visibilidade por enum NONE:
mensagens futuras autorizadas continuam aparecendo. O Core continua sendo a
barreira de segurança; esconder texto no navegador sozinho não resolve o P0.

## Testes e evidências

Testes adicionados antes da correção, executados contra fonte anterior no
container isolado wapphub-m1-test-wapphub-core-api-1:

```sh
node --import tsx --test --test-name-pattern='transfer .* preserves|conversation previews require' tests/chat.test.ts
```

Resultado antes: **5 cenários, 2 passaram/3 falharam**: NONE e ausência de
messages.read com/sem supervisão expunham texto. Depois: **5/5 passaram**.
As fixtures são sintéticas e removidas ao fim; guards exigem NODE_ENV=test e
banco com sufixo _test. Nenhuma credencial/dado real foi utilizado.

Core: dois testes parametrizados novos (sem leitura, com/sem supervisão), mais
extensão dos três testes FULL/LIMITED/NONE e do teste Demo. Cobrem detail/list,
paginação de inbox e histórico limit1, ausência de preview, supervisor legítimo,
ex-assignee404, tenant estrangeiro, replay sem corpo, live WS sem messages.read,
metadata conversation.updated permitido, mensagens novas após NONE e Demo
INBOUND com preview válido. Testes antigos de recibos/idempotência/transfer/
constraints/replay permanecem. Suíte completa: **58 testes aprovados**, zero
falhas; lint/typecheck/build/OpenAPI aprovados.

Chat: cinco cenários novos — preview válido em FULL/LIMITED/NONE, ausência de
messages.read mesmo com supervise e refresh realtime, e null sem fallback para
conteúdo anterior. **91 testes em16 arquivos aprovados**, lint/typecheck/build
aprovados, incluindo otimista/retry/IME/scroll/Demo/rotas/permissões existentes.

Smoke HTTP/WebSocket do Core passou com dados isolados. Também foi executado
contra **API nova compilada** em listener TCP de loopback com porta efêmera,
sem reiniciar o serviço de teste ou produção: wrapper temporário substituiu o
baseURL do smoke existente pelo listener novo, conferiu preview autorizado,
executou login/CSRF/bootstrap, Demo, texto, idempotência, WS/replay/archive e
removeu script/fixtures/conexões ao terminar. O smoke padrão do projeto aponta
para seu serviço existente; não confundir essa execução com o listener novo.

Logs de evidência temporários: /tmp/wapphub-p0-before.log,
/tmp/wapphub-p0-after-focused.log, /tmp/wapphub-p0-core-final.log,
/tmp/wapphub-p0-new-code-smoke.log e /tmp/wapphub-p0-chat-build.log. Resultados
registrados aqui independentemente da disponibilidade futura de /tmp.
Não houve browser, Playwright visual, Chromium/Firefox ou screenshots no Homelab.

## Compatibilidade, migrations e riscos residuais

Prisma/schema/SQLs existentes não foram alterados. **Nenhuma migration necessária.**
Prisma validate e migrate status passaram no ambiente isolado (seis migrations
aplicadas, sem pendências). Inspeção read-only migrate diff retornou exit2:
cinco FKs Demo têm nomes SQL customizados, enquanto schema sem map espera nomes
gerados por Prisma. O SQL de diff apenas troca nomes de FKs em ContactIdentity,
Conversation e Message; mesmas colunas, referências, ON DELETE e ON UPDATE.
Isso já existe nos SQLs/schema de Core72d05aa, ambos inalterados pela correção.
Não foi executado o SQL gerado, nem adicionada migration ou map fora do escopo.
Registrar normalização de nomes separadamente, sem reescrever migrations aplicadas.
Evidências: /tmp/wapphub-p0-prisma-checks.log e /tmp/wapphub-p0-prisma-diff.sql.

OpenAPI oficial validado e inalterado: lastMessagePreview já aceita string|null.
Mudança é correção de autorização de valores, não novo campo/endpoint/payload.
Tipos Chat e envelope realtime versão1 permanecem. Backends/clients existentes
que tratam null continuam compatíveis; consumidores não podem assumir preview
sempre preenchida nem autorização por visibility ou role. O modelo de Message,
Demo, senderUserId/senderContactId e retry não mudou.

A1 está corrigido e validado **localmente**, mas produção ainda não corrigida.
A2 (checkpoint antes de REST/fila após close), diferenças de retry Demo/autoria
visual e aceites M1 restantes não foram alterados. Conteúdo já entregue a um
usuário autorizado não pode ser apagado retroativamente de clientes/arquivos.
Esta correção evita novas leituras indiretas; não alega purge remoto ou compliance.
Sem benchmark de carga adicional; sem query N+1 nova e include de mensagens
reduzido em caminhos internos. Homologação visual futura no notebook.

## Publicação segura recomendada — não executada

1. Revisar os commits locais e dependências de branches publicadas ainda não
   integradas. Confirmar Git limpo, tag/revision da imagem e configuração real.
2. Após autorização explícita, construir imagem Core versionada do commit da
   correção; validar build/contratos e preservar imagem Demo compatível anterior.
3. Publicar Core compatível primeiro, mantendo banco/Redis/redes/variáveis;
   sem migration, seed ou downgrade para Core pré-Demo. Se imagem comum API/Worker
   exigir atualização de ambos, essa operação deve constar na autorização.
4. Readiness/OpenAPI/logs e smoke não mutável; cenários de autorização com
   identidades sintéticas somente em ambiente isolado/homologação aprovada.
5. Publicar Chat versionado para defesa adicional, preservando imagem Lucide
   anterior. Core corrigido funciona com Chat anterior; Chat novo não protege
   outros consumidores de um Core ainda vulnerável.
6. Homologar manualmente no notebook preview autorizado/null, transferência,
   mensagens futuras, duas orgs, Demo/IME/retry/scroll. Registrar aprovação.

Rollback frontend pode usar imagem anterior mantendo Core corrigido. Voltar a
Core72d05aa reintroduz o P0; preferir forward fix/Core compatível corrigido.
Em emergência, restrição temporária/redução de acesso exige plano autorizado;
não restaurar banco nem remover schema para recuperar aplicação. Core pré-Demo
é incompatível com dados externos persistidos; rollback só de binário não é seguro.
