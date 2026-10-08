# Aceite final M1 — Chat Interno

## Decisão e identificação

Milestone: **M1 — Chat interno independente da Meta**, conforme `wapphub-core/docs/MILESTONES.md`. Objetivo original: validar domínio e experiência realtime sem provider externo. Data do registro: 2026-10-08.

**Aceite funcional: homologado pelo usuário em produção.** O usuário declarou que P0 (cinco cenários), P1 (sete cenários) e funcionalidades finais M1 (nove cenários) passaram, incluindo mensagens, inbox/histórico, transferências FULL/LIMITED/NONE, permissions/isolamento, Demo, contatos e criação/reutilização manual. Esta é evidência operacional declarada pelo proprietário; o Codex não executou os cenários no notebook, não possui screenshots e não inventa o roteiro individual dos 5/7/9 cenários. As três contagens são execuções diferentes, não testes automatizados únicos ou cobertura visual exaustiva.

**Encerramento administrativo: pendente de integração Git revisada.** As branches locais de integração estão preparadas, mas main remota ainda não preserva integralmente produção e os PRs documentais antigos divergem. Não houve push, merge ou encerramento remoto. Recomendação: aceitar funcionalmente o M1 e concluir o encerramento administrativo somente após publicação/revisão das branches e conciliação dos PRs documentais. M2 não foi iniciado nem autorizado por esta auditoria.

## Fonte homologada e produção verificada

| Serviço | Commit homologado | Imagem | Image ID/digest local |
| --- | --- | --- | --- |
| Core/API e Worker | `a45fb330ceeb6a703c463174f4fa560ad070e226` | `wapphub-core:m1-contacts-a45fb33` | `sha256:e3a48fddb1b83ce6a73f85937022aa2650e54ae620db7f4501d14e01720de021` |
| Chat | `6b04e653d03fa5b06aafad205b9c760072c01fd0` | `wapphub-chat:m1-contacts-6b04e65` | `sha256:c0d88b8c40c3363f68cc913ea35fa9a4398df03e36e6e2799fc8bf82e270926b` |

Docs pós-deploy: Core `c8faef35d8b270af6f32e516e4deba91c92bc420`; Chat `4997d19b330c9de5b997fd37ce9efc4cd3527776`. Diferem da revisão publicada somente em docs de deploy/status. A auditoria cria apenas documentos depois desses commits. Produção não foi alterada.

Leitura final: todos os cinco containers healthy, IDs/StartedAt iguais ao último deploy. Labels de imagem correspondem aos commits homologados. Fontes Core em execução (18 arquivos src) correspondem ao manifesto; Worker usa mesma imagem. OpenAPI público igual ao contrato validado. Assets JS/CSS públicos têm SHA-256 idêntico ao registro do build publicado; health/readiness HTTP200. Evidências seguras em `evidence/M1_FINAL_20261008/`.

## Matriz vigente de escopo e evidência

Classificações: **H** = Implementado e homologado (declaração do usuário, sustentada por testes); **A** = Implementado e validado automaticamente (sem atribuir homologação específica inexistente); **P** = Parcial; **N** = Não implementado; **F** = Fora do escopo M1. A homologação genérica não é prova exaustiva de cada combinação de RBAC/viewports.

| Requisito | Estado | Evidência técnica e limites |
| --- | --- | --- |
| Autenticação, sessões revogáveis, logout | H | Foundation/SessionContext/Sidebar; foundation.test.ts: cookies/CSRF, revogação/expiração; homologação operacional geral |
| Organizations/Memberships e permissions | H | Foundation + Chat.context, Guards; testes negativos tenant/role, troca de contexto/requests atrasados; confirmação do usuário |
| Isolamento tenant REST/WS/visual | H | FKs compostas, queries tenant-scoped, cursor/stream/gateway; AppShell e cancelamento P1; usuário confirmou isolamento |
| AuditEvent/SecurityEvent mínimos | A | mutation transacional + auditoria; eventos de login/logout/contexto, testes Core. Não equivale a painel de auditoria comercial |
| Inbox, filtros, histórico/cursor | H | InboxList/Conversations/conversationModel, REST autorizado, cursores vinculados ao escopo; testes+homologação |
| Texto interno, status, otimista/clientMessageId/retry | H | unicidade persistida, send/receipts, Chat.submitMessage; concorrência/duplicidade/IME; usuário confirmou |
| Assignment manual e roster | H | Chat.assign/teamMembers, ConversationActions/UserSelect; testes de elegibilidade/permissions e homologações anteriores |
| Transfer FULL/LIMITED/NONE, supervisão | H | messageReadFloor/limites persistidos, Chat.assign/messages/notes/stream; P0 negativo e confirmação explícita do usuário |
| Tags na conversa (aplicar/remover/filtrar) | A | Core CRUD/vínculos/audit; ConversationActions e ConversationView tests; smoke histórico M1. Não inferir cadastro de catálogo via UI |
| Notes internas e archive/unarchive | A | Core+Chat comandos reais e testes; smoke histórico M1_VALIDATION/DEPLOYMENT; sem declaração de cenário final individual |
| REST/OpenAPI/erros padronizados | A | schemas Fastify, AppError/apiClient; validação contrato/erros e produção OpenAPI conferida |
| WS/replay/reconciliação após falha | H | stream persistido/Redis wake, gateway serial, RealtimeClient/bus ACK REST; P1 7 cenários confirmados |
| Rotas reais e refresh profundo | H | BrowserRouter/Nginx fallback; HTTP shell/asset igual ao build, homologações anteriores das rotas/UI |
| Bootstrap, UI por permissions, design tokens/responsividade | H | Guards, SessionContext, Sidebar, useMessageScroll; testes jsdom+build; homologação manual informada, sem certificação de acessibilidade completa |
| Demo Provider e identidade externa separada | H | MessagingProvider/ingestion/ContactIdentity; Providers, testes tenant/idempotência/policies e usuário |
| Contatos: lista/busca/cursor/cadastro/edição | H | contratos existentes q/providers, ContactBrowser/Form/Contacts; 6 testes Core/19 Contacts Chat; 9 cenários finais confirmados |
| Criação manual interna/reutilização/inbox | H | createConversation opt-in sob lock, NewConversation e realtimeBus.reconcile; concorrência/perms/P0; 9 cenários finais |
| Catálogo Tags no frontend | P | CRUD Core disponível, rota /app/tags placeholder; operações exigidas na conversa funcionam. Tela própria não exigida nos seis critérios M1 |
| Retry incerto do simulador Demo e autoria visual OUTBOUND | P | limitações P2 herdadas da auditoria: nova chave por tentativa Demo, rótulo usa usuário da sessão; identidade persistida correta. Não altera idempotência do compositor principal |
| Meta, mídia e upload/áudio/rich text | F | M3/M4; ferramentas desabilitadas, nenhum suporte externo prometido |
| Entitlements, seats, Admin/Minha Conta, convites comerciais | F | M2 não implementado; documento de planejamento preexistente não é entrega funcional |
| Benchmark ~100 agentes/restore/MVP comercial | F | M5; concorrência básica não comprova carga ou recuperação de backup |

## Seis critérios obrigatórios originais

| Critério MILESTONES | Evidência de aceite |
| --- | --- |
| Organizations permanecem isoladas | Testes REST/FKs/WS negativos + homologação declarada de permissões e multi-tenancy |
| Multi-Organization alterna sem vazamento visual/realtime | SessionContext/AppShell/cancelamento/gerações P1, testes de troca e homologação do usuário |
| Conversa criada, atribuída, transferida, tageada, anotada e arquivada | Fluxo manual publicado/homologado; operações Core/Chat testadas, smoke histórico M1 documentado; P0 cobre histórico/prévias |
| Duas sessões observam atualização realtime coerente | Core live/replay histórico, testes integração P1 e confirmação dos sete cenários P1 |
| Queda/reconexão não perde estado persistido | stream persistido e reconciliação P1 após falhas REST, retry/backoff; tests e homologação P1 |
| Refresh em rota profunda funciona | fallback Nginx/testes/smokes anteriores e disponibilidade HTTP atual; rotas reais preservadas |

Não há bloqueador funcional obrigatório conhecido em aberto após as entregas homologadas. Isso não elimina os limites P2 ou substitui a pendência administrativa Git.

## Evidências automatizadas reaproveitadas

Última suíte funcional completa: **64 Core + 160 Chat**, 224 testes entre dois projetos, não somados aos relatórios anteriores como testes únicos adicionais. Core funcional `e32ed65c45ec0b5bc3e5afbdccd76d533ff0c7ae`; Chat funcional `be151d7e430d649fe8b2ce26b875e7b1fbfe334d`. Manifestos M1_CONTACTS conferidos (35/66 arquivos), commits posteriores sem alteração funcional. Lint/typecheck/build/diff check aprovados, Core Prisma e OpenAPI aprovados; logs preservados.

P0: Core `cbaf50c5eedd6731e1ca3a674c1d9b0b20005a7d`, Chat `d93efc576bd560fcbab0146343fb98bbbc1d0b69`; 58/91 testes daquela entrega, reproduções negativas e smoke HTTP/WS isolado registrados em P0_PREVIEW_AUTHORIZATION. Não há necessidade de reproduzir novamente contra clientes reais.

P1: funcionais `dc70f6a`/`cc61ef02b31e39a90a794f18eb3dd07fe14fc663`, publicação `6bbc1c474f6f5b8f321bd957f8e904bb9016147a`; 129 testes/19 arquivos naquela execução. Manifesto P1 conferido contra blobs do commit histórico (não contra código de contatos posterior). Fonte de P1 pode ter evolução legítima em componentes consumidores; a suíte final 160 cobre as regressões.

As evidências antigas não são manifests do HEAD atual. Evidências sem log permanente adicional usam o relatório histórico, com essa limitação de rastreabilidade. Não se afirma execução independente nova. Nenhuma suíte, lint/typecheck/build ou browser reexecutado nesta auditoria: não houve divergência funcional/dependência relevante.

## Arquitetura e compatibilidade

Core é monólito modular: Foundation valida sessão/contexto/Membership; Chat valida permission e tenant por operação. Mutações bloqueiam Organization e persistem domínio + AuditEvent + RealtimeEvent na mesma transação. Redis publica sinal, MariaDB mantém estado/eventos. Controller/schema trata contratos; gateway revalida autorização/contexto em entrega/replay. Cursor não substitui autorização; P0 aplica messageReadFloor também a prévias e eventos (inclusive supervisor exige messages.read).

Chat mantém projeções REST autorizadas. P1 aguarda callbacks async do bus e reconciliação antes de confirmar checkpoint por usuário/Organization/aba; fila serial, timeout e backoff limitado, geração/AbortSignals e paginação obsoleta impedem respostas antigas. Sem componente montado, não há cache durável: bootstrap posterior carrega REST atual. Não usa corpo irrestrito WS; eventos v1 carregam IDs. Reconexão final reconcilia inclusive eventos invisíveis.

Chat/Demo compartilham chatApi/apiClient, sessão/permissions, bus/checkpoint/reconciliação, hook de atalhos e preferência por conta. Não compartilham compositor/otimismo/histórico integral: Demo é ferramenta autenticada limitada. INBOUND associa ContactIdentity/senderContactId; OUTBOUND associa Principal/senderUserId. A sessão do atendente autoriza simulação, não se torna identidade do contato externo. Não se infere autor pelo texto ou nome de plano.

Contatos e criação manual usam endpoints existentes, extensão q/providers/reuseExisting aditiva; lock de criação opt-in, auditoria e eventos normais. Comandos locais reconciliam via P1; sucesso POST com falha GET só repete reconciliação. Nenhuma migration nova de contatos/P0/P1. As seis migrations históricas permanecem versionadas; diferenças preexistentes nos nomes de cinco FKs não foram corrigidas/aplicadas nesta execução.

## Limitações e riscos residuais

| Limite | Avaliação M1 |
| --- | --- |
| Criação manual apenas interna, Meta indisponível | Aceitável: objetivo independente de provider; Meta M3 |
| Reutilização opt-in, sem unicidade global/idempotência durável | Aceitável: múltiplas conversas permitidas por modelo; concorrência opt-in testada; não promessa exactly-once |
| Sem evento Contact dedicado | Aceitável: comandos locais/bootstrap/reconnect reconciliam; sessão externa pode exigir atualizar lista; rename invalida conversas existentes |
| Reconexão reseta páginas/scroll, indisponibilidade persistente exige retry | Aceitável: segurança e consistência preferidas a preservação offline; sem garantia de entrega exactly-once |
| Stream sem política de retenção/compactação definitiva | Aceitável M1; retenção futura exige resync explícito, não prometer cursor eternamente válido |
| Sem benchmark carga, search substring/lock Organization | Não bloqueia M1; medição/escala M5 antes de alegar capacidade comercial |
| Backup sem teste de restauração/offsite comprovado | Não bloqueia critérios funcionais M1; risco operacional M5, não declarar recuperação garantida |
| Catálogo Tags UI parcial | Não bloqueia operação de tagear do aceite M1; permanecer explícito como melhoria, não tela completa |
| Retry incerto Demo pode duplicar; rótulo OUTBOUND pode nomear atendente atual | Resíduos P2 conhecidos, sem falsificar autoria persistida; revisão futura separada recomendada, não declarados corrigidos pela homologação |
| Acessibilidade/touch/viewports sem evidência exaustiva | Homologação informada não certifica cobertura de todas as combinações; risco UX residual |
| Código homologado apenas em branches locais | Bloqueador administrativo até consolidação remota revisada, sem perda local |

Nenhuma destas limitações autoriza alteração funcional nesta execução. FEATURES/SECURITY/arquitetura descrevem também baseline futura; convite/entitlement/recovery completos não devem ser retroativamente cobrados como escopo M1. Roadmap original preservado.

## Integração e decisão recomendada

Ver [inventário final e estratégia](M1_FINAL_GIT_CONSOLIDATION.md), [histórico de releases](M1_RELEASE_HISTORY.md) e [registro de deploy](DEPLOY_M1_CONTACTS_20261008.md). Branch local de integração baseada no tip homologado + docs pós-deploy: `integration/m1-accepted-20261008`.

Recomenda-se **aceite funcional M1 registrado; encerramento administrativo ainda aberto**. Para conclusão administrativa: autorização específica de push/PR, revisão de toda a cadeia e resolução documental explícita dos drafts #7 Core/#3 Chat, integração preservando commits (merge commit autorizado futuramente, sem squash/rebase/force), confirmação de ancestralidade do código homologado na main e atualização final do registro. Não é necessário redeploy para consolidar docs. Não iniciar M2 nesta execução.
