# M1 — contatos e criação manual de conversas — 2026-10-08

> Atualização de aceite final: o usuário confirmou nove cenários finais M1, além de cinco P0 e sete P1. **Homologação funcional declarada concluída**, não executada pelo Codex. [Aceite e limites](M1_FINAL_ACCEPTANCE.md). Pendência administrativa: integração Git, sem novo deploy. Os resultados/pendências abaixo registram o momento original da publicação/implementação.

## Estado e diagnóstico

Implementação e validação **locais**, branch `feat/m1-contacts-conversation-creation` em ambos os repositórios. Nenhum deploy, push, merge ou operação de produção nesta entrega. M1 não está formalmente encerrado; estas funcionalidades aguardam publicação autorizada e homologação.

Produção informada pelo usuário: Core/API/Worker `cbaf50c5eedd6731e1ca3a674c1d9b0b20005a7d` (`wapphub-core:p0-preview-cbaf50c`), Chat `6bbc1c474f6f5b8f321bd957f8e904bb9016147a` (`wapphub-chat:p1-realtime-6bbc1c4`). P0 e P1 publicados e homologados manualmente pelo usuário. O commit documental P1 `fb199b2` e a reconciliação anterior foram preservados nas ancestrais das branches.

Core já possuía CRUD parcial de contatos, cursor tenant-scoped, unicidade de identificador por Organization, criação interna de conversas e auditoria. Chat tinha placeholders de contatos e nenhuma criação manual. Faltavam busca server-side paginada, proveniência de provedor no DTO e reutilização explícita de conversa existente. Não existe unicidade global de conversa por contato: o modelo permite múltiplas conversas, inclusive canais externos.

## Contratos e regras

Nenhum endpoint novo, alteração Prisma ou migration. Extensões aditivas de OpenAPI:

| Operação existente | Uso/alteração |
| --- | --- |
| GET /api/v1/contacts | `q` opcional (máximo 254), busca literal por nome/identificador, cursor vinculado à busca e Organization; `contacts.read` |
| POST /api/v1/contacts | Nome e primaryIdentifier suportados; `contacts.write`, validação e conflito de unicidade existentes |
| GET /api/v1/contacts/{id} | Detalhe tenant-scoped; `contacts.read` |
| PATCH /api/v1/contacts/{id} | Campos autorizados pelo contrato; `contacts.write`, auditoria; rename invalida conversas relacionadas |
| POST /api/v1/conversations | `contactId`, `reuseExisting:true` opcional; resposta `reused` opcional, mantém status/contrato legado |

Contact DTO acrescenta `providers` (DEMO/META), derivado de identidades existentes; não expõe IDs de canal nem segredos. O Chat aceita o campo ausente. Identificadores de contatos vinculados a provedores ficam somente leitura na UI; nome permanece editável. Não há exclusão.

Criação requer `conversations.create`; reutilização também exige `conversations.read`. A UI requer ainda `contacts.read`. Busca, cursor e mutações resolvem tenant a partir da sessão/Membership. Reutilização consulta apenas conversa interna aberta/pendente visível (própria, não atribuída, ou supervisor autorizado), sob o mutex transacional de Organization existente. Conversas arquivadas ou inacessíveis não são reabertas/divulgadas. A operação opt-in concorrente retorna a mesma conversa acessível; não promete exatamente uma vez nem impede múltiplas conversas via contrato legado. Auditoria `CONVERSATION_REUSED`, sem novo evento de criação; criação normal emite o evento existente.

## Interface e atualização

ContactBrowser: listagem, busca explícita, cursor, seleção, nome/identificador separados, proveniência e erros. ContactForm: cadastro/edição, limites, conflito amigável, trava de envio, retry somente de reconciliação depois de sucesso REST. Contacts: rotas existentes de lista/detalhe, edição condicional e isolamento por conta/Organization.

NewConversation: rota `/app/conversations/new`, ação Nova conversa na inbox/detalhe, seleção ou cadastro inline, confirmação, reutilização amigável e abertura imediata no filtro correto da inbox. Não envia mensagem durante criação. Conversa **interna**, sem seletor de canal externo fictício. Demo continua provisionado por ativação/ingestão próprias; indisponibilidade do Demo não impede conversa interna. Meta não foi habilitada.

Reutiliza layout, Lucide, tokens, apiClient (sessão/CSRF), realtimeBus P1 e permissões existentes. Mutações chamam `realtimeBus.reconcile(organizationId)` antes de concluir navegação. Falha de atualização preserva resultado da mutação; botão tenta reconciliar sem repetir POST bem-sucedido. Não fabrica eventos ou avança checkpoint paralelo. `conversation.created` continua atualizando inbox via REST autorizado. Renomear contato emite o tipo existente `conversation.updated` das conversas relacionadas e atualiza metadados; referência estável evita desmontar a assinatura durante reconciliação.

AbortSignals, gerações e guards de ciclo de vida descartam respostas obsoletas, inclusive paginação, troca de conta/Organization, seleção e desmontagem. Erros 403/404 purgam dados que perderam autorização. Falhas transitórias seguem recuperação P1. Prévia na reutilização é nula; não há leitura indireta de mensagens. FULL/LIMITED/NONE e messages.read continuam sujeitos a P0. Compositor, payload de envio, idempotência de mensagens e checkpoints não foram alterados.

## Evidências e aceite local

Core funcional validado: `e32ed65c45ec0b5bc3e5afbdccd76d533ff0c7ae`. Chat funcional validado: `be151d7e430d649fe8b2ce26b875e7b1fbfe334d`. Commits documentais posteriores não alteram esses artefatos. Logs e manifestos em `evidence/M1_CONTACTS_20261008/`; os manifestos registram hashes dos arquivos funcionais/dependências/build.

| Critério | Evidência | Estado |
| --- | --- | --- |
| Contatos: lista, busca, cursor, cadastro, edição, duplicidade | Core sintético + Chat mock REST | Implementado e validado localmente |
| Criação, reutilização e concorrência | 6 criações concorrentes no Core; UI e inbox reais em testes | Implementado e validado localmente |
| RBAC, tenant, campos inválidos, ausência de messages.read/NONE | Testes negativos Core/Chat | Implementado e validado localmente |
| Falha REST, retry sem repetir criação, troca de contexto/desmontagem | Chat unitário/integração | Implementado e validado localmente |
| Realtime inbox e rename; P0/P1 e Demo | Suítes completas existentes e novas | Regressões automatizadas aprovadas |
| Uso em produção e responsividade visual | Homologação manual após deploy futuro | Pendente |

Core: **64 testes aprovados (6 novos)**, lint, typecheck, build, Prisma validate e OpenAPI validate aprovados. Execução em projeto `wapphub-m1-test`, banco sintético isolado, sem migration nesta tarefa. Docker build de teste aprovado. Chat: **160 testes em 21 arquivos (31 novos)**, lint sem avisos, typecheck, build e diff check aprovados. Vitest/jsdom, sem browser gráfico. Bundle JS 352,71 kB (gzip 109,37); CSS 35,63 kB (gzip 6,94). Sem dependência nova ou alteração de lockfile/Dockerfile/Compose. O build Docker de produção ainda deverá ser realizado no deploy.

Cenários novos incluem pesquisa/paginação e literal de wildcard, conflitos, permissões e tenant estrangeiro, reutilização concorrente e conversa arquivada/inacessível, Demo indisponível e identidade preservada, cadastro inline, falhas REST, paginação obsoleta, troca de Organization, desmontagem, inbox por realtime, deduplicação e rename preservando histórico. As suites anteriores P0/P1 permanecem aprovadas. Não foram executados browser, screenshots, testes mutáveis de produção ou homologação visual.

## Limites e riscos

- Reutilização é opt-in baseada no estado atual e acesso; contrato legado e conversas encerradas permitem criação adicional. Não é chave de idempotência durável.
- Contatos não têm evento realtime dedicado: lista é atualizada por comandos locais, bootstrap e reconciliação/reconexão. Cadastro feito por outra sessão não aparece imediatamente em uma lista já aberta sem atualização. Renomeações invalidam as conversas relacionadas pelo evento existente.
- Busca por substring pode escanear registros tenant-scoped; não foi feito benchmark de grande volume. Busca explícita evita requisições por tecla, resultados limitados/paginados; sem cache amplo ou polling.
- Reconciliação pode reiniciar páginas carregadas; mantém consistência em vez de mesclar páginas antigas.
- Criação manual não provisiona canal Demo/Meta. Não altera identidades externas, histórico, mensagens ou regras de transferência.
- Homologação visual e funcional dos novos fluxos continua pendente; a integração das branches locais no GitHub requer revisão/autorização separada.

## Publicação futura e contingência

Após autorização: preservar imagens P0/P1 e configurações; confirmar commits/fontes iguais aos manifestos e reaproveitar testes, sem repetir baterias completas se equivalentes. Construir imagens versionadas usando Dockerfiles existentes. Publicar **Core/API e Worker compatível primeiro**, com Compose real e no-deps, sem migrations, depois gate de health/readiness/logs e compatibilidade; somente então publicar Chat. O Chat novo depende das extensões de busca/reutilização e não deve preceder Core.

Validar HTTP/login/SPA/assets/versão, health/readiness, preservação dos serviços e logs sem dados comerciais mutáveis. Em falha de Chat, frontend P1 anterior permanece referência de contingência compatível. Se avaliar reversão de Core corrigido para P0, primeiro retirar Chat novo pois depende do contrato aditivo; decisão controlada, sem banco. Nunca retornar à versão Core vulnerável `demo-72d05aa`. Registrar imagens/IDs, operações e resultado. Nenhuma publicação realizada aqui.

## Homologação manual no notebook

1. Testar lista, pesquisa nome/identificador, cursor, vazio, erros e nomes longos em 1920×1080, 1366×768, 1024×768, 768×1024 e 390×844.
2. Cadastrar contato, invalidar campos, tentar identificador duplicado; editar manual e nome de Demo sem alterar identidade externa; confirmar organização ativa.
3. Criar conversa com contato existente e cadastro inline; confirmar inbox, filtro, abertura/compositor e conversa já existente. Testar duplo clique e falha/retry.
4. Verificar usuário somente leitura, sem leitura e supervisor; duas Organizations/contas não devem misturar resultados.
5. Confirmar Demo enviado/recebido no fluxo próprio e conversa interna com Demo indisponível; nenhuma opção Meta.
6. Confirmar P0 em transferências FULL/LIMITED/NONE e sem messages.read; nenhuma prévia indevida.
7. Reconectar rede, trocar conversa/Organization durante consultas, renomear contato e conferir histórico/compositor/inbox sem duplicação ou regressão P1.

Encerramento formal M1 depende de publicação autorizada, homologação destes fluxos e revisão final da matriz existente. Roadmap e critérios originais preservados; M2 não iniciado.
