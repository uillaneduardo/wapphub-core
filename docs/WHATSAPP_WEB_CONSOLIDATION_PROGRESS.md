# WappHub — acompanhamento canônico de consolidação

**Criado:** 2026-10-11. **Estado global:** `PUBLICADO — AGUARDANDO_RECUPERACAO_DA_SESSAO` (publicação técnica realizada; B5 ainda não concluído). Autorização explícita para integrar e publicar B5 recebida em 2026-10-12; B6 continua sob responsabilidade de homologação do usuário.

Diagnóstico A0/A1: [WHATSAPP_WEB_CONSOLIDATION_AUDIT.md](WHATSAPP_WEB_CONSOLIDATION_AUDIT.md). A auditoria registrou falhas no remoto main então inspecionado; os P0 foram corrigidos e a CI das branches B está verde. Main e produção permanecem distintos das branches de revisão.

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
| B2 — Core/Worker e persistência | VALIDADO_TECNICAMENTE (local e CI) | Core131/131, Provider90/90; PR27; migrations12/OpenAPI/drift | Revisão PR27; B5 depende de autorização |
| B3 — Envio/recebimento, nova conversa, mídia e Chat | VALIDADO_TECNICAMENTE (local e CI; sintético) | PR27 + ChatPR19; Chat294/294; runtime multimídia sem rede | Homologação real/visual após B5 autorizado |
| B4 — Regressão/performance/segurança | VALIDADO_TECNICAMENTE | Todas CI verdes; limites Docker/bytes/cache; negativas e regressões | [Plano B5](WHATSAPP_WEB_CONSOLIDATION_B5.md), sem execução |
| B5 — Publicação controlada | PUBLICADO — AGUARDANDO_RECUPERACAO_DA_SESSAO | main8dbd7fb/6e92234, imagens/migration12/backups/restore/smokes/CI comprovados; FAILED preservado | Usuário confirma uma tentativa no Chat; não concluir B5 sem conexão/recursos essenciais |
| B6 — Homologação final | PENDENTE — AGUARDANDO_CONEXAO | roteiro humano publicado; nenhum browser no homelab | Após recuperação confirmada, usuário homologa no notebook |

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

### 2026-10-11T22:19:29.129616+00:00 — B4 — PRs e correção da configuração de CI

Estado: EM_ANDAMENTO. Core/Provider c117b20eec991a30f5b8745ea84654ea1f4685b9 PR27 https://github.com/uillaneduardo/wapphub-core/pull/27 (basePR26); Chat3afd2fffa074887dfd3ff4fbb676cc666fa3d1dd PR19 https://github.com/uillaneduardo/wapphub-chat/pull/19 (base34acd1f). Nenhum merge/deploy.

Core131/131 e todos10checks0 no schema isolado release (core-checks-b4release.json), Chat294/294 confirmado (chat-test-release-confirm.log); teste legado AppShell isolado tambémverde. CIChat38179832791success. CICore38179831434falha typecheck: job instalava apenasnode_modulesCore, novos fixtures/HTTPtypeimportreferenciamBaileys Provider (TS2307). Corrigido workflow para npmci tambémdoadapter, lockfilesinalterados; nãoexcluir fontes/testesnemrelaxartipos. CIProvider38179831431emexecução.

final-preservation.json: IDs/imagens/StartedAt dos6serviçosidênticos baseline, healthy,1socketativo,RSS180MB;checkoutsoperacionaislimpos. Próximaação: CI dosSHAscorrigidos, fecharB4/documentarB5.

### 2026-10-11T22:23:22.474236+00:00 — B4 — encerramento técnico integrado

Estado: VALIDADO_TECNICAMENTE. Ambiente: branches de revisão, serviços sintéticos isolados e conferência read-only de produção. Sem merge, deploy, alteração da sessão produtiva, migration produtiva, pareamento, mensagens reais ou solicitações históricas reais.

Commits funcionais: Core/Provider B1 eb5e667c277ba9d26b105c7b686933cbc3dacdf7 (PR26); B2–B4 c117b20eec991a30f5b8745ea84654ea1f4685b9 e configuração CI c86b07ca208e57d118e1928757f3baba2790bb54 (PR27, base PR26). Chat 3afd2fffa074887dfd3ff4fbb676cc666fa3d1dd (PR19, base main34acd1f). PR25 continua documental, aprovado tecnicamente e sem merge; nenhum PR integrado nesta execução.

CI **success** do SHA funcional c86b07c:
- Core: https://github.com/uillaneduardo/wapphub-core/actions/runs/38179967004
- Provider: https://github.com/uillaneduardo/wapphub-core/actions/runs/38179967011
- Chat SHA3afd2ff: https://github.com/uillaneduardo/wapphub-chat/actions/runs/38179832791

Local final: Core131/131, Provider90/90, Chat294/294; lint/typecheck/build verdes. Doze migrations, Prisma/drift/OpenAPI em banco isolado; runtime real da imagem com SDK/uploader sintéticos e sem rede: cinco envios sintéticos/zero reais, imagem/áudio/voz/vídeo e WebM→Opus. Compose smoke apenas projeto isolado. Falha inicial CI de dependências do adapter corrigida sem excluir testes; flake legado AppShell sob carga registrado, suite final e CI Chat passaram sem alterar expectativas/timeouts.

Evidências: ~/homelab/deploy-records/wapphub-provider-web/20261011-consolidation-b1-b4/{TESTES.md,IMPLEMENTACAO.md,ci-validated-functional.json,core-checks-b4release.json,core-test-b4release.log,provider-test-b4-final.log,chat-test-release-confirm.log,media-runtime-final.log,provider-compose-smoke-final.log,final-preservation.json,final-domain-readonly.json}. Relatório e manifest final incluem o SHA documental de encerramento após commit.

Produção: seis serviços healthy com IDs/imagens/StartedAt idênticos ao baseline; Core/Source CONNECTED, um socket ativo, attempts históricos5, grant ENABLED e produtor PAUSED; requests=1 preexistente, historicalMessages=0. Quatorze falhas legadas, novas falhas0. Checkouts operacionais Coredb85dac/Chatf13752f limpos; imagens publicadas continuam CP47. Imagem construída é exclusivamente local de teste, não publicada.

Limites/riscos remanescentes: disponibilidade histórica/bytes depende do WhatsApp; não declarar histórico integral ou entrega real. Cache/ref expiram e possuem quotas; codecs aceitos limitados. Recursos do homelab exigem observar backlog/RSS/disk em B5. Bundle Chat509kB/gzip161kB mantém aviso Vite. Reconexão real do código novo e layouts/gravação/players dependem de B5/B6. Rollback deve interpretar recoveryFailures/receipts/cursors; CP47 antigo não é presumido seguro. Grant histórico existente precisa permanecer sem novas requests durante publicação.

Próxima ação segura: revisão dos PRs e [plano B5](WHATSAPP_WEB_CONSOLIDATION_B5.md) mediante autorização específica; backups/restauração isolada/imagens/deploy produtivos ainda não executados. B6 pelo usuário após publicação autorizada. Documento de implementação consolidado: [IMPLEMENTATION](WHATSAPP_WEB_CONSOLIDATION_IMPLEMENTATION.md). Nenhuma alteração funcional após c86b07c; este encerramento apenas registra evidências/documentação.

### 2026-10-12 — B5 — início autorizado e baseline

Estado: `EM_ANDAMENTO`. A autorização explícita do usuário substitui as notas históricas deste plano que diziam que B5 ainda dependia de autorização. Nenhum merge, migration, backup produtivo, reinício ou interação WhatsApp foi executado neste gate.

Revisão PR27 (uillaneduardo, 2026-10-12T04:39:24Z) registrada: exige integração PR25→26→27 e Chat19 com CI final; teste HTTP binário ponta a ponta no Core; validação do recovery Vault `attempts=5`; backup/restauração isolada e migration aditiva; flags novas fechadas; B6 humana. Comentário íntegro no PR27; sem threads inline.

Checkouts limpos e remotos alinhados antes da execução: Core branch `feat/consolidation-b2-b4` SHA `1db2828aa49ce1aefb43038168901e01dea012cc`, ancestry B1 `eb5e667`, PR27; Chat branch `feat/consolidation-b3-chat` SHA `3afd2fffa074887dfd3ff4fbb676cc666fa3d1dd`, PR19. PR25/26/27/19 abertos; bases encadeadas conforme esperado. CI anterior verde: Core `38180232903`, Provider `38180232953`, Chat `38179832791`; são SHAs de branch e a CI final-main ainda precisa ser confirmada.

Baseline Docker 2026-10-12T04:40Z: API `88989f6c…`, Worker `1823611e…`, Provider `77b03629…`, Chat `8d7e2f85…`, DB `65750f14…` e Redis `1ec5cdfb…`, todos healthy. Imagens continuam Core/Worker/Provider `cp47-bb356c7` e Chat `cp47-6cd6898`; App/Worker iniciados 2026-10-11T10:23:59Z, Provider 10:24:11Z e Chat 10:24:22Z; DB/Redis sem reinício desde 2026-10-07. Recursos: 7.1 GiB RAM, 3.8 GiB disponível, swap 4 GiB (2.2 usados), disco root 14 GiB disponíveis. Sessão e contadores serão rechecados read-only imediatamente antes de qualquer restart. Último baseline sanitizado confirmado: CONNECTED/socket ativo, `attempts=5`, grant ENABLED, operação PAUSED/HISTORY_BYTE_LIMIT, 1 solicitação remota histórica preexistente, 0 mensagens históricas, 14 falhas legadas/0 novas. Flags de histórico serão mantidas fechadas antes/depois da publicação; grant e Vault não serão alterados para autorizar novas requests.

Próximo gate: cobrir o upload com integração HTTP Core→cliente assinado→Provider totalmente sintética e revisar compatibilidade/backup sem rede antes de qualquer merge/deploy. Se a capacidade de preservar a sessão não for demonstrável, Provider não será reiniciado.

### 2026-10-12T04:59Z — B5 — gate de sessão e upload ponta a ponta

O teste existente foi ampliado para percorrer a rota `application/octet-stream` do Fastify Core, validação de sessão/Origin/CSRF/RBAC/tenant, `WebProviderClient` com HMAC e endpoint HTTP real sintético do Provider até `ProviderMedia`/PrivateFiles. Valida sucesso sintético, Content-Type inválido, limite de bytes, hash incorreto, MIME incompatível, ausência de sessão/CSRF, Origin incorreto, usuário sem permissão, organização diferente, stream interrompido e ausência de `.part` órfão. Um evento live foi adicionado ao journal durante upload bloqueado e permaneceu disponível. O `ffprobe` usado neste contrato foi um stub local sintético; conversão/codec real permanece comprovada apenas no smoke Docker isolado B4. Core lint/typecheck verdes e suíte completa **131/131**, inclusive a integração HTTP, em schema/Redis isolados `wapphub_b5upload_*_test`; nenhum serviço produtivo foi chamado. Ajuste no teste apenas contorna o RSS high-water causado por outro fixture de carga compartilhado; o gate produtivo de 384 MiB continua sem override.

Baseline read-only mais recente, `2026-10-12T04:59:16.568Z`: containers/processos ainda não foram alterados; Provider HTTP `ready=true`, mas conexão Core e Provider `FAILED`, `activeTransport=false`, contador `attempts=5`. O grant e operação estão ambos `PAUSED` com `HISTORY_BYTE_LIMIT`; 1 solicitação remota histórica preexistente, 0 mensagens históricas, 172 mensagens totais, 1.796 comandos `history_*` COMPLETED (reconciliações internas), 0 comandos pendentes, 429 envelopes ProviderInbox persistidos e falhas de diagnóstico 14 legadas/0 novas. Flags atuais Core `PROVIDER_HISTORY_EXECUTION_ENABLED=true`; o gate de deployment continuará fechado. Sem logout, reset, QR, consulta, fetch, envio ou alteração do Vault. A imagem CP47 não pode ser reiniciada com segurança: o caso testado B1 é Vault `CONNECTED/attempts=5`; o estado real atual é `FAILED/attempts=5`, para o qual B1 deliberadamente não cria orçamento novo. Este é bloqueio técnico para qualquer restart/publicação do Provider.

Correção à primeira leitura do baseline neste documento: a snapshot anterior CP4.7 de 04:34Z registrava conexão CONNECTED/grant ENABLED; a leitura de 04:59Z demonstra mudança posterior para FAILED/grant PAUSED. A leitura posterior é o estado prevalecente e será registrada na entrega. O código de erro/cause da sessão não foi incluído ainda; buscar somente diagnóstico sanitizado e logs de produção antes de decidir publicação, sem acionar recuperação.

Próximo: concluir revisão dos diffs/CI e backup/migration em ambiente isolado. Não fazer restart do Provider enquanto o estado permanecer FAILED/esgotado; deploy B5 integral depende de recuperar a pré-condição de segurança sem novo pareamento ou reset manual.


### 2026-10-12T05:21Z — B5 — bloqueio de segurança e validação

Estado global: `B5_BLOQUEADO`. Nenhum merge de PR27/Chat19, backup produtivo, migration em produção, build/publicação de imagem, restart, deploy, envio, upload real ou solicitação histórica real foi executado. PR25 e PR26 foram integrados ao `main` com merges `d55aa668d7840049fae4e63586b7dcfd3cf32ccc` e `dd8719324387e097ef45769ad94df9b04bd39e5e`. PR27 permanece aberto na revisão da branch `feat/consolidation-b2-b4`; SHA remoto consultado `137c036479cb942a6cfbe2b5a0601b5f1403c283` tinha checks `validate` e `provider-web` verdes, mas os ajustes locais posteriores no teste HTTP ainda não foram enviados nem cobertos por CI. PR19 permanece aberto, sem integração final.

O baseline read-only continua sendo o estado mais recente de 04:59:16Z: seis containers healthy e imagens CP4.7; API/Core e Provider reportam conexão `FAILED/RECONNECT_LIMIT`, `attempts=5`, `activeTransport=false`. B1 cobre legado `CONNECTED/attempts=5`, mas intencionalmente não inicia novo orçamento para `FAILED/attempts=5`. Reiniciar o Provider nesse estado não tem garantia técnica suficiente de preservação da sessão vinculada; o deploy foi interrompido antes de qualquer reinício. Contagem histórica permanece 1 solicitação remota preexistente, 0 mensagens históricas; grant/operação PAUSED/HISTORY_BYTE_LIMIT, sem nova atividade remota.

Migração `20261011210000_consolidation_outbound` e as 12 migrations foram aplicadas a schema exclusivamente sintético `wapphub_m1_test`, sem restore de produção. O teste completo correto da branch somou 132 testes: 131 passaram e o novo percurso HTTP binário falhou; após reordenar o fixture, regressão CP4.7 passou. Repetição da suíte `web-provider.test.ts`: 42/43, upload retorna `MEDIA_BUSY` repetidamente. Portanto o percurso HTTP completo ainda não está validado e o teste permanece modificado apenas localmente. CI para SHA remoto anterior: 2/2 checks verdes; não representa este estado local. Não registrar `docs/STATUS.md` como publicado.

Recursos read-only rechecados 05:02Z: API 59.22 MiB, Worker 55.95 MiB, Provider 137.6/512 MiB, Chat 4.852 MiB, MariaDB 58.28 MiB, Redis 1.84 MiB; todos seis healthy. Nenhuma mudança em container, Compose, banco produtivo, Vault, volume ou sessão. Nenhum backup foi criado porque a validação de restore operacional não pôde preceder um deploy não seguro; nenhum snapshot Signal foi restaurado.

Evidências e pendências: relatório em `~/homelab/deploy-records/wapphub-provider-web/20261012-consolidation-b5/`. Próximo passo técnico é corrigir e passar o teste de upload com CI final antes de integrar PR27 e PR19. O gate de Provider exige diagnóstico/recovery seguro para `FAILED/attempts=5` sem logout, alteração de contador, QR ou novo pareamento; então repetir backup/restauração isolada, validar migration em restore, verificar flags/grant e executar publicação controlada. Estado não equivale a B6; navegador permanece para homologação do usuário após deploy autorizado.


### 2026-10-12T05:41:51.064868+00:00 — correção integrada dos bloqueios B5 e P0 de encerramento

Estado: EM_ANDAMENTO; B5 permanece bloqueado para publicação. Retomadas branches existentes Core feat/consolidation-b2-b4 (137c036) e Chat feat/consolidation-b3-chat (3afd2ff), PR27/19 abertos; main Core dd87193 já integra PR25/26. Preservados docs/teste HTTP locais não commitados. Autorização desta rodada cobre correção/testes/CI/PRs, não deploy, recovery real, logout, QR, envio, histórico remoto ou migration produtiva. STATUS permanece intacto.

Leitura sem escrita da produção 05:40Z: FAILED/RECONNECT_LIMIT, desired=true, attempts=5, recoveryFailures ausente, Vault AES-GCM autenticado (0600), credenciais vinculadas com pares identity/noise presentes, 847 entradas Signal todas JSON válidas (16 strings e 831 objetos). registered=false não prova revogação. Logs mostram RECONNECTING→CONNECTED em 2026-10-11T10:24:16.243Z, FAILED em 2026-10-12T00:31:46.350Z; códigos numéricos antigos não foram persistidos. Imagem CP4.7 usa attempts cumulativos para o limite e não os zera em open: a falha posterior encerrou o ciclo já no teto; causa de transporte não reconstruível, sem evidência de revogação/corrupção. Nenhum OOM/restart registrado.

P0 adicional confirmado: Core traduz disconnect em logout; Sessions bloqueia encerramento linkedRecoveryOnly e remove auth/keys antes do resultado remoto; Chat desabilita em ERROR e promete revogação. Correção planejada reutiliza outbox/receipts/Vault: parada reversível, desvinculação com resultado remoto explícito, recovery administrativo de uma tentativa sem QR/retry cego e fence durável contra comandos antigos. MEDIA_BUSY será distinguido entre pressão RSS e lock, com teste HTTP em fixture independente e cleanup/cancel comprovados.

### 2026-10-12T06:33:35.957499+00:00 — correções B5 — gates locais encerrados; CI pendente

Estado global mantido `B5_BLOQUEADO` até CI dos heads novos. Sem reexecutar B1–B4; preservado teste HTTP e documentos pendentes. Core133/133; Provider117/117; Chat300/300; HTTP isolado1/1; lint/typecheck/build verdes. Novo contrato lifecycle/recover/logout/confirmation/controlVersion, Core RBAC/outbox e Worker, Vault aditivo, adapter IQ ACK e Chat conectados. P0 gerenciamento de vínculo integra critérios de retomada, inclusive FAILED, ausência de socket, timeout, corrida com reconexão, duplicatas e restart.

Causa de RECONNECT_LIMIT: CP4.7 acumula attempts de partidas e não zera orçamento após open; última conexão autenticada comprovada em 2026-10-11T10:24:16.243Z, FAILED em 2026-10-12T00:31:46.350Z. Código numérico do close não foi persistido; causa de transporte indeterminada, sem evidência de revogação/corrupção. Vault GCM/estrutura válidos, 847 entradas Signal parseáveis, auth existente; desired=true, attempts5, recoveryFailures ausente. Não há socket. Histórico requests1/messages0/PAUSED/HISTORY_BYTE_LIMIT.

MEDIA_BUSY reproduzido por RSS443.039.744>402.653.184, sem transferência concorrente. Erro agora MEDIA_MEMORY_PRESSURE; fixture HTTP isolado, nenhum override do limite. Bloqueio global1 mantido; streams/codecs/cache cancelados e finalizados antes da liberação. Teste integral e isolado exercitam cadeia HTTP/sessão/CSRF/Origin/HMAC/cache, cancelamento, upload posterior e live concorrente.

Prisma/schema12/migration12/OpenAPI/drift validados apenas em test DB; zero drift novo, cinco diferenças legadas M1 mantidas. Chat300 passou na confirmação integral sem mudar asserções/timeouts; execução inicial299/300 falhou em AppShell realtime legado sob compilação concorrente. Provider passou117 após corrigir scheduler do teste para capturar apenas backoff<=30.250ms em vez de confundir deadline com backoff. Diagnóstico RSS não é suíte de aceite: foi reprodutor de falha; as suítes finais são as reportadas acima. Fixtures diagnósticos interrompidos foram limpos apenas no banco _test; container de teste antigo pendurado finalizado, containers produtivos preservados.

Evidências serão preservadas em `20261012-consolidation-b5/correcoes-20261012/`; próximos passos: commits nas branches existentes, atualização PR27/19 e CI final. STATUS permanece o publicado; nenhum merge/deploy/recovery real/logout/QR/Signal/fetch/envio/upload/migration/restore produtivo ou B6. Risco: WhatsApp pode rejeitar sessão estruturalmente íntegra; só tentativa real explicitamente autorizada+estabilidade poderá comprovar recuperação.

### 2026-10-12T06:38:51.406442+00:00 — correções B5 — B5_PRONTO_PARA_RETOMADA

Os três critérios P0 foram implementados e validados localmente e em CI, incluindo recuperação limitada, parada/desvinculação e upload HTTP. Funcional Core/Provider `d197f292a6442b408e50c7b6fc917126d4ec0e63`, head de evidências locais `6892dfeda8e154844537025590dda44f87c24964`; Chat `90ca77bfd9172222bcecd3f6a300d7095706e5eb`. CI verde Core133/133 [38213173469](https://github.com/uillaneduardo/wapphub-core/actions/runs/38213173469), Provider117/117 [38213173461](https://github.com/uillaneduardo/wapphub-core/actions/runs/38213173461), Chat300/300 [38213173602](https://github.com/uillaneduardo/wapphub-chat/actions/runs/38213173602), incluindo lint/typecheck/build e gates específicos dos workflows. Estes workflows pull_request validam também o merge sintético com main, sem integrar PRs reais. O commit documental deste encerramento será conferido novamente em CI antes de entregar.

PRs [Core27](https://github.com/uillaneduardo/wapphub-core/pull/27) e [Chat19](https://github.com/uillaneduardo/wapphub-chat/pull/19) permanecem abertos, mergeable, sem merge nesta rodada. Main Core `dd8719324387e097ef45769ad94df9b04bd39e5e` e Chat `34acd1fd212663b1685b45517e8a7fb548ddb871` não foram alterados. ALTERAÇÕES locais anteriores preservadas e incorporadas nas branches; STATUS permanece idêntico ao início desta rodada.

Conferência final read-only2026-10-12T06:35–06:36Z:6containers healthy, mesmos IDs/StartedAt/revisions, restart0/OOMfalse; CP4.7 permanece publicado. Sessão FAILED/RECONNECT_LIMIT,attempts5,desiredtrue,recoveryFailures ausente,auth/847keys íntegros,socketfalse. Hash cifrado do Vault `b4a11fc800b596d8aa2d4483ea7021a1b9f458babbf46f9c7f75005ed647e63a` idêntico ao início,0600/621596bytes. Journal0/comandos pendentes0; grant/operaçãoPAUSED/HISTORY_BYTE_LIMIT,requests1/messages0;14falhas legadas e0novas. Flags técnicas históricas Core/Provider continuamtrue, Provider HISTORY_ENABLED=false e scope controltrue; o grant pausado foi preservado, sem converter em nova autorização. Outbound/media unset (defaultsfalse). SQL produtivo11migrations;12somente em test DB, sem migration produtiva.

Estado B5_PRONTO_PARA_RETOMADA refere-se à prontidão técnica das correções; **não significa sessão recuperada nem B5 publicado**. Causa numérica de transporte permanece indeterminada por ausência de registro legado. Próxima execução exige autorização de retomada B5, revisão/integração dos heads finais, baseline/backups/restauração isolada/migration12/rollback compatível e publicação controlada. Nenhuma tentativa real sem confirmação administrativa explícita; open+30s estáveis são condição de êxito, sem reset/QR/autoloop. Nenhum deploy/restart/backup/restore/migration produtivos, recovery/logout/Signal/pareamento, envio/upload/fetch remoto ou B6 nesta rodada. Evidências e riscos em `20261012-consolidation-b5/correcoes-20261012/RELATORIO.md`; [plano B5 atualizado](WHATSAPP_WEB_CONSOLIDATION_B5.md).

### 2026-10-12T07:06:19.702087+00:00 — B5 — retomada autorizada, sem recuperação remota

Estado: EM_ANDAMENTO. Usuário autoriza integração PR27/Chat19, backups/restauração/migration e publicação controlada; proíbe recuperação real, logout, QR, envio/consulta/upload real e histórico remoto. Último estado técnico B5_PRONTO_PARA_RETOMADA conferido; AGENTS e plano/relatório lidos. PR25/26 integrados (d55aa668/dd871932), PR27 head5467a52 e Chat19 head90ca77b abertos/mergeable com CI final verde. Checkouts funcionais e operacionais sem alterações locais anteriores. Estado produtivo CP4.7 ainda distinto de main e das branches.

Sequência: conferir diffs/CI/ancestry → merges com SHA esperado → CI e validação local de main → baseline sanitizado/backup consistente/restauração isolada/migration12 → imagens e rollback compatíveis → Core/Worker, Provider, Chat → smokes sem comandos remotos. Gates de histórico serão fechados e capacidades por conexão false. Sessão FAILED esgotada deve ficar sem socket, sem nova tentativa; recuperação só por confirmação futura no Chat. Se publicação técnica ocorrer com sessão indisponível, registrar PUBLICADO — AGUARDANDO_RECUPERACAO_DA_SESSAO, sem concluir B5/B6. Evidências preservadas em 20261012-consolidation-b5/retomada-publicacao/.

### 2026-10-12T07:12:14.654115+00:00 — B5 — integração e gate CI pendente

PR27 integrado como24f99c0948cb1ea046174b0ca92bdba2a54eda23 e Chat19 como6e922348b2274119f185a94222831b9e54f3ee65. Main Core/Chat conferidos; local Core133/133+schema/drift/OpenAPI e Provider117/117. CI Core verde38215923050; Chat verde38215926991. Provider main38215923040 falhou116/117 no teste legado sync.test.ts:178: esperava seen.length0 após sleep30ms, mas historyImports ainda undefined porque o callback de staging não iniciou. Sem erro de protocolo/sessão; nenhum runtime produtivo alterado. A correção mínima de teste aguarda o callback real (barreira) mantendo a asserção de checkpoint vazio enquanto persistência bloqueada. Sem relaxar limites/asserções nem aumentar timeout. Validação/CI adicional exigida antes de publicação.

### 2026-10-12T07:17:51.184663+00:00 — B5 — gates de backup/restauração e CI de correção aprovados

PR28 ajusta somente a barreira do teste legado (327be19439c5b6f4afd0b9a716e7f453d478288c), CI Core38216580396/Provider38216580370 verdes, Provider local117/117; integrado como8dbd7fbba768af9aa9cffc7e31515d6ee458afd5, main final em validação CI. Chat main6e922348b2274119f185a94222831b9e54f3ee65 com CI38215926991 verde e local300/300/lint/typecheck/build. Core local133/133/schema12/drift/OpenAPI aprovados; nenhuma mudança funcional após PR27.

Baseline CP4.7 preservado: seis serviços healthy, sessãoFAILED/RECONNECT_LIMIT,attempts5,sem socket; grant/operaçãoPAUSED/HISTORY_BYTE_LIMIT,requests1/messages0,14falhas legadas/0novas. RAM3.3GiB disponível, disco14.4GiB; snapshot Vault estável621596bytes/hashb4a11fc8…0600,847Signal keys,0journal.

Backups consistentes em ~/homelab/backups/wapphub-consolidation/pre-b5-20261012-071320/: SQL single-transaction509805bytes/hash78034b2a06b443296cddb2abd41454fdca7b6fc0219eefd7a91c0cdb0ec3f074; Vault/cache cifrado622132bytes/hashd96f793b0990195d9c785d7db77fd265ac72dbdb5a92ce469457aaeb91127e53; configurações/keys sob0700/0600. Arquivo e restauração do volume conferidos. SQL restaurado em MariaDB efêmero/rede internal sem Provider/WhatsApp; migration12 aplicada só ao restore,24tabelas com todos campos legados exatamente preservados por hash,8checks referenciais sem violações, defaultsfalse, ledgerchecksumsGit e drift legadoM1 inalterados. Backup real/restauração/migration validados; nenhum DDL/restart produtivo ainda. Imagens finais8dbd7fb/6e92234 em construção; rollback Provider somente código compatível novo com gates fechados, nunca CP4.7 ou snapshotSignal antigo.

### 2026-10-12T07:36:12.795799+00:00 — B5 — PUBLICADO — AGUARDANDO_RECUPERACAO_DA_SESSAO

Autor: Codex. Publicação técnica realizada conforme autorização de retomada, **sem tentativa real de recuperação**. B5 não está concluído e B6 não está homologado. PR27 merge24f99c0948cb1ea046174b0ca92bdba2a54eda23; PR28 (barreira de teste) merge8dbd7fbba768af9aa9cffc7e31515d6ee458afd5; Chat19 merge6e922348b2274119f185a94222831b9e54f3ee65. Código de runtime Core/Worker/Provider8dbd7fb e Chat6e92234. PR25/26 pré-integrados, sem duplicação/rebase.

CI final-main success: [Core133/133 —38216863842](https://github.com/uillaneduardo/wapphub-core/actions/runs/38216863842), [Provider117/117 —38216863883](https://github.com/uillaneduardo/wapphub-core/actions/runs/38216863883), [Chat300/300 —38215926991](https://github.com/uillaneduardo/wapphub-chat/actions/runs/38215926991). Lint/typecheck/build/Prisma/schema12/drift/OpenAPI verdes. Falha temporal inicial116/117 preservada e corrigida, sem asserções enfraquecidas. Backup real/restauração/migration12 validados antes de produção (24tabelas/8checks referenciais/dados legados iguais/defaultsfalse). Imagem com cópia do Vault real em networknone comprovou0chamadas de transporte/attempts5/auth/Signal/history preservados e elegibilidade administrativa. Runtime multimídia e Compose isolados passaram,5envios sintéticos/0reais.

Migrations: `20261011210000_consolidation_outbound` aplicada em produção, ledger12 válido, hashes de dados administrativos/mensagens/contatos/conversas preservados; novas capacidadesfalse por conexão. Publicados após backup/restore/imagens/rollback, na ordem Core/API+Worker → Provider → Chat. Imagens `wapphub-core:b5-8dbd7fb`, `wapphub-provider-web:b5-8dbd7fb`, `wapphub-chat:b5-6e92234`, labels/revisions exatas. Imagens anteriores mantidas; Provider rollback seguro é código novo compatível com gates fechados, não CP4.7. Sem restauração de Signal ou downgrade destrutivo.

Conferência pós-deploy07:26–07:31Z:6serviços healthy/ready, HTTPS/API/SPA/deeplinks/assets atuais e contrato lifecycle/OpenAPI publicados. RedisPONG, upgrade realtimeHTTP401sem sessão, Worker heartbeat; evento connection.updated de bootstrap persistido e ACKado (ProviderInbox429→430), journal0/backlog0/comandos pendentes0.14falhas legadas e0falhas novas do produtor. DB/Redis e demais aplicações preservam IDs/StartedAt; container efêmero de validação Core terminou normalmente e foi excluído apenas desse inventário. Sem erros críticos/OOM/restarts; Provider~78MiB/512MiB.

Sessão real permanece FAILED/RECONNECT_LIMIT,attempts5,recoveryFailures ausente preservado,linkedtrue,socketfalse,recoveryEligibletrue; **health não significa WhatsApp conectado**. Credenciais/847Signal entries/operação/referência cifradas preservadas por digests privados; alterações normais de metadados/revision/journal não equivalem a mudança de auth. Nenhuma entrada recovery/termination nem comando recover criado. Histórico grant/operaçãoPAUSED/HISTORY_BYTE_LIMIT, requests1→1, mensagens históricas0→0 e1796comandos históricos iguais; nenhum download remoto. Flags de execução históricafalse em Core/Worker/Provider; outbound/media técnicastrue, mas conexãofalse. Canal WebDISABLED por FAILED, DemoDISABLED preservado.

Usuário deve acessar Configurações→Provedores→WhatsApp→Gerenciar conexão→**Recuperar vínculo existente**, com providers.manage, ler e confirmar **uma tentativa**. Core valida sessão/Origin/CSRF/RBAC/tenant, Worker reautoriza e Provider persiste antes da rede. RUNNING→AUTHENTICATED→SUCCEEDED somente após open+30s estáveis, limite total120s, sem QR/autoloop. Falha/timeout/interrupção exige diagnóstico e nova confirmação, nunca reset de counters/Signal. Após conexão/recursos essenciais confirmados, B6 humana no notebook.

Evidências completas: ~/homelab/deploy-records/wapphub-provider-web/20261012-consolidation-b5/{RELATORIO,DEPLOY,TESTES,BACKUPS,ROLLBACK,HOMOLOGACAO}.md; subdiretório retomada-publicacao/ inclui manifests de imagens/backups/restore/CI/continuidade/smokes. Histórico anterior preservado. docs/STATUS.md atualizado apenas com fatos publicados. Commits documentais/checks finais desta entrega serão registrados no manifest local, sem rebuild/restart por alteração exclusivamente documental. Nenhum logout/QR/pareamento, recuperação/envio/consulta/upload/fetch real pelo Codex, nem B6.

### 2026-10-12T14:22Z — simplificação do vínculo — EM_ANDAMENTO

Nova autorização inclui implementação/PR/merge/deploy, sem operações WhatsApp reais. Main Core4076ea4/Chat0c0dd06 limpos; imagens b5-8dbd7fb/b5-6e92234 ainda publicadas, seis serviços healthy. Baseline real diverge do anterior: usuário solicitou logout, agora DISCONNECTED/UNCONFIRMED/LOGOUT_TRANSPORT_UNAVAILABLE, linkedtrue/desiredfalse/socketfalse/attempts5; grant pausado, requests1/messages0. Atendimento foi autorizado pelo usuário (booleans por conexão true), será preservado na publicação; nenhuma ativação feita por Codex. Nova vinculação exigirá confirmação explícita de remoção pelo celular, nunca socket ausente como prova. Lacunas: linkedRecoveryOnly global bloqueia primeiro QR e logout confirmado bloqueia novo vínculo. Alteração mínima: elegibilidade explícita Provider, preparação aditiva pelo outbox existente, aposentadoria criptografada limitada de auth/Signal somente sob prova ou confirmação administrativa, autorização escopada de pairing; UI derivação tipada e ação contextual única. Não há nova fila/máquina persistida/migration. Evidências em20261012-whatsapp-link-simplification/.

### 2026-10-12T14:38Z — simplificação — implementação e gates locais

Core HTTP/outbox/Worker/HMAC/QR sintético passou133/133; Prisma schema12/OpenAPI atualizado/validado/drift0novo (5FK legadas). Provider121/121 inicial e122/122 com factory real RC14/mocks, nova revisão inclui distinção401/403 e redução de cópias do Vault (gate final pendente). Chat UI38+derivação15=321totais; teste legado de operação pendente adaptado ao estado de atualização, sem asserções removidas. Suíte final/lint/typecheck/build e CI ainda pendentes. Backup real514411bytesSQL/622471bytesVault em pre-link-ui-20261012-143124, hashes no manifest restrito; restore SQL/redeinternal sem WhatsApp preservou25tabelas,8checks referenciais,12→12migrations/defaultsfalse/autorizações existentes, Vault/cache restaurados isoladamente. Nenhuma modificação de produção. Contrato prepare_link e QR escopado documentados emWHATSAPP_WEB_LINK_MANAGEMENT.md; nenhum novo schema/serviço/fila. Próximo gate: revisões finais/PR/CI, imagens e teste de bootstrap com cópia do Vault real, publicação ordenada.

### 2026-10-12T14:38:37.759184+00:00 — simplificação — VALIDADO_TECNICAMENTE / PR e CI pendentes

Core133/133 completo+uploadHTTP/OpenAPI/drift/migration12/lint/typecheck/build aprovados. Provider final124/124 (inclui401/403, arquivo criptografado limitado, primeiro pairing escopado, restart semQR e todas regressões). Chat integral321/321 e56/56 focados após indicador QR e teste do cliente prepare_link; resultado integral final será comprovado pela CI. Sem mudanças de dependências/migrations. Backup/restauração isolados aprovados; sessão produtiva permanece DISCONNECTED/logoutUNCONFIRMED sem transporte, attempts5 e credenciais preservadas. Próximo gate: PRs e CI dos SHAs reais; publicações exigem imagem testada contra cópia do Vault atual, gates globais mantidos, nenhuma operação remota.

### 2026-10-12T14:42Z — revisão final — guard de identidade após primeiro QR

Revisão detectou que a permissão passada ao factory poderia permanecer efetiva após open do primeiro pareamento. Guard corrigido para consultar autorização persistida escopada e prazo em cada atualização de identidade; open remove o grant de pairing e volta imediatamente à proteção linked-only. Teste SDK RC14 sintético comprova primeira identidade aceita e tentativa subsequente de remover identidade rejeitada, sem sobrescrever auth. Nenhuma operação produtiva; CI novo SHA será exigida antes de merge.
