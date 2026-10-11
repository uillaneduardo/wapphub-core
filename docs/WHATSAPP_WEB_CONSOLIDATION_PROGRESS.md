# WappHub — acompanhamento canônico de consolidação

**Criado:** 2026-10-11. **Estado global:** `EXECUCAO_B1_B4`. **Próxima ação:** concluir revisão/CI dos PRs integrados B2–B4; plano B5 sem execução. Aprovação técnica do PR25 recebida; B5/B6 não autorizadas.

Diagnóstico A0/A1: [WHATSAPP_WEB_CONSOLIDATION_AUDIT.md](WHATSAPP_WEB_CONSOLIDATION_AUDIT.md). Auditoria concluída não significa código integralmente aprovado: Provider remoto apresenta duas falhas locais em78testes e CI main falho; defeitos e riscos estão documentados para correção após aprovação.

## Referências mandatórias
- Fluxo e gates: [WHATSAPP_WEB_CONSOLIDATION_EXECUTION.md](WHATSAPP_WEB_CONSOLIDATION_EXECUTION.md)
- Arquitetura e regras: [ARCHITECTURE.md](ARCHITECTURE.md), [DOMAIN.md](DOMAIN.md), [SECURITY_PRIVACY.md](SECURITY_PRIVACY.md), [PROVIDER_CONTRACT.md](PROVIDER_CONTRACT.md).
- Regras locais: `AGENTS.md`, `services/wapphub-provider-web/AGENTS.md`, `wapphub-chat/AGENTS.md` e `wapphub-platform/AGENTS.md`.
- Evidências reais de deploy: diretórios existentes de `~/homelab/deploy-records/` (localizar e conferir, nunca supor).
- PR relacionado: https://github.com/uillaneduardo/wapphub-core/pull/23 (merge informado; deployment não verificado aqui). Incluí-lo na auditoria de código/risco.

## Critério de atualização

Codex **deve atualizar este arquivo ao iniciar e concluir cada fase**, ao registrar decisão, bloqueio ou mudança relevante; atualizar a mesma branch/PR em commits pequenos. Uma linha `VALIDADO_TECNICAMENTE` exige teste reproduzido; `PUBLICADO` exige evidência de deploy real; `HOMOLOGADO` exige confirmação do usuário. Preservar histórico e registrar UTC, ambiente, autor e evidências sem dados privados.

A cada execução, reler este documento, comparar SHA local/remoto/produção e retomar do próximo gate pendente. Não recriar tarefas concluídas, não atualizar `docs/STATUS.md` com progresso hipotético.

## Matriz de acompanhamento

| Fase | Estado | Evidências exigidas | Próxima ação |
| --- | --- | --- | --- |
| A0 — Contexto e baseline | VALIDADO_TECNICAMENTE | git-inventory.json, baseline-services/domain.json, session-state.json; local/remoto/publicado distintos | Baseline preservado; conferir novamente ao retomar |
| A1 — Auditoria Core/Provider/Baileys/Chat | VALIDADO_TECNICAMENTE (auditoria, com falhas encontradas) | AUDIT; inventário SDK/código e probes; Core127/127, Provider76/78, Chat287/287; CI verificado | Corrigir lacunas somente após aprovação |
| A2 — Plano arquitetural/produto | APROVADO_TECNICAMENTE (PR25/revisão do usuário) | PROPOSAL; matriz existente/lacuna/teste/risco, diagrama, capabilities, limites, contratos, ADRs e rollback | B1–B4 autorizadas; B5 exige autorização específica |
| B1 — Provider e captura/reconexão | VALIDADO_TECNICAMENTE (local e CI verde) | testes sintéticos SDK e contratos, sessão preservada | Revisão dos PRs, sem merge/deploy |
| B2 — Core/Worker e persistência | EM_ANDAMENTO | tenant/RBAC/ingestão/dedup/paginação/outbox | Revisão dos PRs, sem merge/deploy |
| B3 — Envio/recebimento, nova conversa, mídia e Chat | EM_ANDAMENTO | texto e mídia, contato existente e número não cadastrado, status/autoria, UI | Revisão dos PRs, sem merge/deploy |
| B4 — Regressão/performance/segurança | EM_ANDAMENTO | testes Core/Provider/Chat, CI, recursos, segurança | Após B1–B3 |
| B5 — Publicação controlada | BLOQUEADO_POR_APROVACAO | backups/restauração/rollback, imagens, smokes, sessão | Exigir autorização de deploy |
| B6 — Homologação final | BLOQUEADO_POR_APROVACAO | roteiro e feedback do usuário no navegador | Aguardar homologação humana |

## Requisitos de negócio aceitos para projeto — verificar implementação

- WappHub: inbox compartilhada, equipe e permissões, contatos/conversas/mensagens, atribuição, supervisão, tags, notas e filtros; Demo Provider permanece funcional sem WhatsApp real.
- WhatsApp Web via Baileys: sessão por dispositivo vinculado do Owner, eventos novos continuamente sincronizados, captura histórica inicial quando disponível, backfill progressivo limitado por lote, sem prometer acesso integral ao que o WhatsApp não disponibiliza.
- **Bidirecional real:** receber e enviar; responder conversa; **iniciar conversa usando contato existente ou número digitado ainda não cadastrado**, validando destinatário/canal/tenant e criando vínculo somente quando apropriado. Texto, imagem, áudio e vídeo; chamadas fora do escopo atual.
- Destinatário novo ≠ número existente no WhatsApp; tratar inexistência e erro de validação sem enviar nem criar conversa indevida. Envio é ação explícita do operador, nunca feito por automação de teste.
- Separar arquivamento remoto (metadado) do estado arquivado interno e manter tags/atribuição internas. Preservar autor, idempotência, ordenação, permissões de visibilidade por atendente e dedup cross-replay.
- Mídia sob demanda com inspeção/streaming/cache temporário quando necessário, sem depender de URL remota eterna nem armazenar automaticamente tudo no servidor.
- Homologação manual no notebook do usuário, não por browser no homelab.

## Registro de execução (append-only)

### 2026-10-11 — Preparação documental (GitHub; sem acesso runtime)

- **Responsável:** ChatGPT por conexão GitHub; ambiente: somente repositórios.
- **Estado:** fluxo criado em branch documental; nenhuma auditoria nova no homelab, nenhuma alteração funcional ou solicitação real do WhatsApp executada nesta etapa.
- **Ponto em aberto:** confirmar diferenças entre repositório `main`, imagens Docker publicadas, PR #23 e volume/sessão atuais.
- **Próxima ação segura:** Codex iniciar A0 e completar A1/A2; publicar proposta revisável, sem deploy nem envio real.

### Modelo obrigatório para próximas entradas

```text
### <data UTC> — <fase> — <ação>
Estado: PENDENTE | EM_ANDAMENTO | BLOQUEADO | VALIDADO_TECNICAMENTE | PUBLICADO | AGUARDANDO_HOMOLOGACAO | HOMOLOGADO
Ambiente: <isolado/local/produção>
Repos / branches / SHAs: ...
Evidências: <comandos, resultados, caminhos de relatórios sem segredos, PRs>
Itens reaproveitados / removidos / alterados: ...
Riscos / dependências / decisões: ...
Próxima ação segura: ...
```

### 2026-10-11T19:40:30.160006+00:00 — A0 — início e baseline

Estado: EM_ANDAMENTO. Ambiente: leitura de produção e Git; edição somente documental em worktree isolado.

Core original limpo em main db85dac; remoto 766ff09 inclui PR23 funcional ainda não publicada e PR24 documental. Chat original limpo f13752f; remoto 34acd1f altera somente AGENTS. Branch de documentação docs/consolidation-a0-a2-20261011 criada a partir de 766ff09 em /home/uillan/homelab/apps/wapphub-core-consolidation-audit; checkouts operacionais preservados.

Evidências: ~/homelab/deploy-records/wapphub-provider-web/20261011-consolidation-a0-a2/{baseline-services.json,baseline-domain.json,resources.txt}. Seis serviços healthy; imagens CP47; fonte/Core CONNECTED e transporte ativo. Há 1 grant ENABLED, 1 solicitação remota previamente registrada, produtor PAUSED e 0 mensagens historical=true. Nenhuma operação real disparada por esta auditoria.

Próxima ação segura: concluir inventário/flags/SDK e rastrear fluxos A1 sem alterar funcionalidade. B1–B6 permanecem bloqueadas por aprovação; publicação não autorizada nesta execução.

### 2026-10-11T19:42:17.105753+00:00 — A0 — concluída; A1 — início

Estado A0: VALIDADO_TECNICAMENTE. Comparação Git/Docker/flags reproduzida por leitura. Provider instalado/runtime Baileys 7.0.0-rc14. Platform não localizado entre repos/apps; fora do escopo, AGENTS indisponível. Projetos legados wapphub/chat inventariados separadamente, sem participação nos contratos atuais.

A1: EM_ANDAMENTO. Evidência adicional: history-state.json e session-state.json no diretório A0/A2. Source PAUSED/HISTORY_BYTE_LIMIT, referência criptografada presente, falhas da operação 2, requests=1, grant ENABLED. Mais de 1200 history_reconcile COMPLETED são comandos internos de renovação, não solicitações WhatsApp; avaliar desperdício em pausa sem progresso. Guard de sessão attempts=5, limite persistido5: nenhum reinício permitido por esta auditoria.

Próxima ação: rastrear SDK/fluxos e reproduzir testes sintéticos seguros; nenhuma execução funcional em produção.

### 2026-10-11T19:48:21.779382+00:00 — A1 — achados reproduzidos

Estado: EM_ANDAMENTO. Código auditado em 766ff09; produção continua CP47. Lint/typecheck Provider aprovados; suíte sintética: 76/78 aprovados, 2 falhas na validação da janela temporal (fixtures usam dois Date.now). CI push 766ff09 também falha no npm test do Provider; Core CI aprovado. Logs provider-*.log e core-provider-ci-jobs.json. Sem correção aplicada.

Sonda externa synthetic-bootstrap-probe.mts, socket mock e vault temporário, reproduziu no código da PR23: após RECENT100 e initialPending=false, append recente não chega ao staging (0), notify chega (1). nativeBootstrap capturado no início do socket continua true, mas Sessions.historyEnabled já retorna false. Evidência synthetic-bootstrap-probe.json; falha ainda não publicada.

Chat: lint/typecheck e 287 testes/30 arquivos aprovados, somente jsdom. Core regressões estão sendo reproduzidas em banco novo terminado _test no serviço isolado; produção não utilizada para testes. Próxima ação: consolidar inventário e proposta A2, incluindo riscos antes de qualquer publicação futura.

### 2026-10-11T19:48:54.986189+00:00 — A2 — início da proposta consolidada

Estado: EM_ANDAMENTO. Inventário A1 consolidado para revisão: contratos SDK-independentes, vault/journal/Worker/Inbox SQL/realtime e UI existentes reutilizáveis. Lacunas demonstradas: ausência de outbound Web/resolução de destinatário/binários; bootstrap com limite cumulativo e corte silencioso; append após término do bootstrap; reconciliação em pausa; guard lifetime5; metadata remota esparsa; capabilities sem direção.

Artefatos em preparação: WHATSAPP_WEB_CONSOLIDATION_AUDIT.md e WHATSAPP_WEB_CONSOLIDATION_PROPOSAL.md, ambos documentação, sem segundo registro de progresso. A1 segue EM_ANDAMENTO somente até encerramento das regressões Core já em execução; fases B continuam bloqueadas. Nenhum código corrigido e nenhuma publicação executada.

### 2026-10-11T19:57:08.377990+00:00 — A1 — encerramento da auditoria

Estado: VALIDADO_TECNICAMENTE para auditoria, não para publicação do código remoto. Ambiente: source766ff09, SDK instalado/runtimeRC14 e testes isolados. Core127/127, lint/typecheck/OpenAPI/Prisma aprovados;11 migrations apenas em schema novo wapphub_consolidation_*_test. Chat287/287, lint/typecheck aprovados. Provider76/78; lint/typecheck aprovados, falhas temporais preservadas. CI main Core success/Provider failure em npm test; Chat success. Sonda confirma append recente perdido após fim bootstrap no código remoto não publicado.

Artefato: WHATSAPP_WEB_CONSOLIDATION_AUDIT.md. Evidências: diretório 20261011-consolidation-a0-a2, source-inventory.txt, scripts sintéticos, checks/logs e snapshots sanitizados. Nenhuma instalação de browser, onWhatsApp real, envio, histórico novo ou pareamento. Próxima ação: revisão final documental A2.

### 2026-10-11T19:57:08.378021+00:00 — A2 — proposta concluída, gate de aprovação

Estado: VALIDADO_TECNICAMENTE para proposta/documentação; aprovação do usuário pendente. Ambiente: worktree docs/consolidation-a0-a2-20261011, base766ff09; checkouts operacionais preservados.

Artefato: WHATSAPP_WEB_CONSOLIDATION_PROPOSAL.md. Matriz de reutilização/correção, responsabilidades e diagrama, capabilities Demo/Web/Meta futuro, destinatário com DDI/PN/LID, outbox existente/UNKNOWN/autoria, mídia streaming/cache privado, bootstrap versus ON_DEMAND, limites por lote versus total, migrations aditivas e sequência B1–B6 com testes/rollback. ADRs propostos: escopo vídeo, política de recuperação, cache/storage local e capabilities de saída.

Decisão proposta: manter arquitetura e contratos; corrigir guard de sessão/CI/transição bootstrap/churn antes de publicação futura, conectar atendimento bidirecional e mídia sem segundo pipeline. Alternativas rejeitadas e riscos materiais constam da proposta. Apenas três documentos próprios alterados/criados; nenhum código funcional ou configuração de produção mudou. B1–B6 continuam bloqueadas.

Próxima ação segura: usuário revisar/aprovar uma única proposta. Aprovação não será presumida; deploy continua sem autorização nesta execução. Ao retomar, comparar Git/produção e ler este progresso antes de implementar.

### 2026-10-11T19:58:45.659113+00:00 — A2 — revisão documental e preservação final

Estado: VALIDADO_TECNICAMENTE para revisão A. git diff --check e verificação de links relativos/fences aprovados. Diff próprio restrito a PROGRESS/AUDIT/PROPOSAL; STATUS, fontes, contratos, manifests, dependências, migrations e Compose não foram alterados. Dependências idênticas reaproveitadas por symlink temporário para testes, removidas após a execução.

final-verification.json comprova os mesmos IDs/imagens/StartedAt dos seis serviços; todos healthy, Core/Source CONNECTED e socket ativo. Checkouts originais Core/Chat limpos. Requests antes/depois=1 preexistente, historicalMessages=0. Nenhum deploy, logout, novo pareamento, envio real ou novo pedido histórico pelo executor. Manifest SHA256SUMS.json no diretório de evidências. Os dados de produção podem evoluir naturalmente pelo Worker/live existente, sem ação mutável desta auditoria.

Próxima ação: aprovação única da proposta. Não iniciar B por inferência nem publicar esta branch documental como imagem de produto.

### 2026-10-11T20:42:35.053126+00:00 — B1 — início autorizado após revisão A2

Estado: EM_ANDAMENTO. Revisão vinculante: https://github.com/uillaneduardo/wapphub-core/pull/25#pullrequestreview-5484867318 (2026-10-11T20:39:38Z), mais instrução explícita do usuário nesta execução. A aprovação inclui texto/imagem/áudio/voz/vídeo e B1–B4; não autoriza merge do PR25, deploy, alteração de sessão produtiva, pareamento, envio ou histórico real.

Core branch fix/consolidation-b1-p0 em worktree próprio, base dfaf9d6; Chat feat/consolidation-b3-chat, base34acd1f. Originais Core db85dac/Chatf13752f preservados. Baseline seis serviços healthy CP47 com mesmos containers; evidências 20261011-consolidation-b1-b4/baseline-services.json.

Condições obrigatórias: P0 append RECENT100/reconexão attempts5/tempo/CI/churn primeiro; histórico progressivo sem teto permanente500/500/1000; intent idempotente com UNKNOWN/autoria; media criptografada stream/RBAC/bytes/hash/TTL; equivalência Demo/ingress; CI verde e progresso por gate. Testes usam somente serviços isolados e SDK socket mock. Próxima ação: corrigir P0 e reproduzir suites antes de conectar saída/mídia.

### 2026-10-11T20:51:17.031185+00:00 — B1 — P0 corrigidos, regressões locais encerradas

Estado: VALIDADO_TECNICAMENTE localmente; CI pendente. Captura dinâmica preserva append recente depois deRECENT100. RecoveryFailures opcional mantém attempts históricos e limita episódio5, três starts/processo no modo vinculado;30s de conexão autenticada estável encerram episódio. Vault legado CONNECTED/attempts5 recupera sem reset manual/auth/Signal/QR; estadoFAILED/esgotado ou revogado não recebe novo orçamento. Fixtures usam um epoch e schema30dias segue estrito. Worker não renova falha de reader-policy pausada a cada15s;25ticks preservam diagnóstico e contagem de comandos.

Provider82/82, lint/typecheck/build aprovados; Core128/128, lint/typecheck/build/Prisma/OpenAPI/drift e11 migrations isoladas aprovados. Logs provider-*-b1*.log/core-*-b1.log em 20261011-consolidation-b1-b4. Nenhuma operação produtiva. Commit/PR P0 serão registrados antes de B2.

Risco B5: CP47 antigo não interpreta recoveryFailures e attempts5 já impede seu restart; rollback deve usar imagem compatível com P0, sem editar/restaurar Signal. Próxima ação: PR B1/CI e B2 integrado, sem merge/deploy.

### 2026-10-11T20:56:13.365935+00:00 — B2 — início da consolidação Core/Worker

Estado: EM_ANDAMENTO. B1 commit eb5e667c277ba9d26b105c7b686933cbc3dacdf7, PR https://github.com/uillaneduardo/wapphub-core/pull/26, base documental PR25 sem merge. Branch feat/consolidation-b2-b4 deriva de B1. Reutilizar ProviderCommand, Inbox, journal, sync.batch e vault; flags novas fechadas por padrão e autorização por conexão. Nenhuma publicação ou operação real. Próxima ação: intents duráveis, identidade, captura progressiva e contratos aditivos.

### 2026-10-11T21:08:57.568850+00:00 — B3 — início integrado com B2

Estado: EM_ANDAMENTO. B1 CI Core/Provider success: actions/runs/38174170784 e38174170771, PR26 sem merge. B2 em implementação/testes: migração aditiva em schema isolado (12 migrations), flags false, outbox send, UNKNOWN, identidade compartilhada, paginação bootstrap, mídia privada. ADR_WHATSAPP_WEB_CONSOLIDATION.md registra vídeo aprovado. B3 começa conexão da API com componentes existentes do Chat; B2 não é declarado concluído por typecheck ou mocks. Sem navegador, produção, envio ou solicitação histórica real.

### 2026-10-11T21:40:24.889493+00:00 — B4 — início das regressões integradas e revisão de segurança

Estado: EM_ANDAMENTO. B2/B3 código conectado em branches isoladas; encerramento técnico depende das suites finais. Provider87/87 e Chat290/290 em passes preliminares; novos testes elevam cobertura. Runtime Docker isolado --network none: imagem/áudio/voz/vídeo, conversãoWebM→Opus, streamingHMAC, criptografia e SDK prepareWAMessageMedia com uploader sintético;5 envios sintéticos/0reais. Logs media-runtime.log/provider-test-b23.log/chat-test-b3-final.log.

Correções durante regressão sem enfraquecer testes: OpenAPI aditivo; fixture de Provider novo usa revision própria, não revision antiga de outro produtor; texto de conflito interno mantido; serial da sessão não fica presa à rede; Worker drena journal durante envio. Bootstrap com correlação scoped independente do grant evita gastar piloto20. Nenhum serviço produtivo alterado; homologação gráfica não executada. Próxima ação: suites finais/CI, revisão de diffs e PRs B2–B4/Chat, documentação B5.

### 2026-10-11T21:54:40.849093+00:00 — B2 — implementação integrada e validação local

Estado: VALIDADO_TECNICAMENTE localmente; CI consolidada exigida em B4. Core131/131, lint/typecheck/build/OpenAPI/Prisma/drift e12 migrations isoladas aprovados (core-checks-b4.json). Provider87/87 mais6/6 de concorrência em passes anteriores; suite final incorpora MIME parametrizado e vínculo de mídia ao echo. OutboxSQL existente, intenção antes da rede, autoriaSQL/PENDING, idempotência/UNKNOWN sem retry cego, consumo do journal duranteenvio, identidade compartilhada e metadata esparsa preservada.

Bootstrap:100registros de wire/até300SyncItems por página, cursor/staging atômicos, arquivo entregue em cacheAES-GCM, janela persistida/backpressure;620conversas/1240mensagens sintéticas sem nova solicitação. Correlação scoped independente do grantON_DEMAND20. Migrations aditivas deliveryOutcome/flagsfalse/Media metadata. Nenhum código, migration, comando ou imagem aplicado à produção. Commit/PR consolidados serão registrados em B4.

### 2026-10-11T22:16:33.316180+00:00 — B3 — atendimento integrado e validação local

Estado: VALIDADO_TECNICAMENTE localmente; CI consolidada pendente em B4. Texto/intenção SQL, contato existente ou númeroE.164 novo, onWhatsApp explícito, idempotência/autor/recibos, UNKNOWN sem retransmitir, imagem/áudio/voz/vídeo e players sob demanda conectados do Chat ao Core/Provider. Flags técnicasfalse e booleans por conexãofalse; autorização auditada viaUI não envia. Reutilização componentes/design tokens, Demo, realtime e posição de leitura; sem browser.

Provider90/90 (provider-test-b4-final.log); imagem Docker somente local de teste, ID8b7ce4d29ec2816468dd8dc738d481208f64c181a08567afd1ee7209923c5211. media-runtime-final.log: IMAGE/AUDIO/VOICE/VIDEO, conversãoWebM, preparaçãoSDK/upload/downloadHMAC sintéticos,5sends/0reais,--network none. Compose smoke isolado saudável/connectionsEnabledfalse. Chat294/294 em chat-test-b4-final.log, lint/typecheck/build verdes; repetição sobCPU reproduziu flake de preview/logout no AppShell, teste isolado verde sem alteração de expectativa/timeout; CI e confirmação da suite completa exigidas. Sem novas dependênciasnpm/lockfiles;FFmpeg sónaimagem.

Core integração amplia prova para retry explícito de autorização revogada antes daRPC, reusandoMsg/comando; âncoras rejeitamPENDING/UNKNOWN/enviointernosemprotocoltimestamp. SQLtrigger apenasbancoteste e callbackRedisfalho provam recuperação sem novoSDKcall. Implantação produtiva e homologação funcional/visual permanecem não executadas. Próxima ação: commits/PRs, aguardar todasasCI, finalizarB4 e planoB5.
