> Atualização12/10/2026,18:50UTC: **INTERFACE_CORRIGIDA_PUBLICADA — AGUARDANDO_VINCULACAO_HUMANA**. Core/Worker/Providerp0link-e6aa1c6, Chatp0link-49bc91d. P0 de quota/reconciliação corrigido; sessãoDISCONNECTED/logoutUNCONFIRMED, sem transporte, preservedattempts5. Não marcar B5 concluído/B6homologado. Detalhes/evidências no registro P0 ao final.

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

Revisão de restart também cobre identidade já persistida antes de open autenticado: a presença de pairingAuthorization interrompe o episódio mesmo quando me já existe. Nenhum transporte/QR é retomado automaticamente nessa janela; credenciais permanecem, somente recuperação explícita elegível. Teste sintético específico adicionado; nova CI integral obrigatória.

### 2026-10-12T15:03:01.144920+00:00 — simplificação — INTERFACE_WHATSAPP_PUBLICADA — AGUARDANDO_HOMOLOGACAO

PR [Core #30](https://github.com/uillaneduardo/wapphub-core/pull/30) integrado em `c90099be41607404b049376dbfdfc0cfcd331eb3`; [Chat #21](https://github.com/uillaneduardo/wapphub-chat/pull/21) em `dd731cb9275edfc84b35da16207e32248e88c10b`. Commits funcionais Core `1cce0a6`, guards `a80f183`/`1cf05d9`; Chat `3a02a62`. CI dos mains: [Core 133/133](https://github.com/uillaneduardo/wapphub-core/actions/runs/38265667741), [Provider 125/125](https://github.com/uillaneduardo/wapphub-core/actions/runs/38265667644), [Chat 322/322](https://github.com/uillaneduardo/wapphub-chat/actions/runs/38265694213). Lint/typecheck/build/schema12/Prisma/OpenAPI e zero drift novo aprovados; nenhuma migration ou dependência nova.

Publicado às14:55Z na ordem Core/Worker → Provider → Chat: imagens `wapphub-core:link-c90099b`, `wapphub-provider-web:link-c90099b`, `wapphub-chat:link-dd731cb`, revisions exatas. Seis serviços healthy/readiness, HTTPS/SPA/rotas/ativos/OpenAPI/realtime protegido/Redis PONG/journal0/comandos0; dados administrativos e mensagens preservados por hashes, DB/Redis/demais aplicações preservam IDs e início. Provider~76MiB/512MiB, sem OOM/restarts. Um PROVIDER_UNAVAILABLE transitório no intervalo de reinício14:55:15, sem repetição após readiness; nenhuma falha crítica persistente.

Backup real/restauração isolada/redeinternal/25tabelas/8checks/defaultsfalse/migration12→12 aprovados em `~/homelab/backups/wapphub-consolidation/pre-link-ui-20261012-143124/`. Manifest revalidado antes de publicar. Imagem contra cópia real do Vault/UID1000/networknone preservou auth/847Signal entries/history/attempts5/termination, factory0; campos aposentados sobreviveram restart sintético. Runtime mídia:5envios sintéticos/0reais. Falhas do script de verificação foram escopo de fixture e mem_limit string, corrigidas sem enfraquecer verificações ou alterar produção.

Estado da conta **DISCONNECTED, desired=false, logout UNCONFIRMED/LOGOUT_TRANSPORT_UNAVAILABLE, linked=true/sem socket/attempts5**. Solicitação de logout foi feita pelo usuário14:04Z antes desta execução, não pelo Codex. Backend confirma preparationEligible=true/removalConfirmationRequired=true/recoveryEligible=false: UI oferece nova vinculação com confirmação de remoção no celular; não força Restabelecer quando inelegível. Credenciais/chaves/referências preservadas; nenhum comando de recuperação, logout, pareamento, QR, envio, upload, consulta ou histórico remoto executado pelo Codex. Requests históricos1→1/mensagens0→0, grant/operação pausados,14falhas legadas/0novas.

Flags globais preservadas: ALLOW_SESSION_CONNECT=true e PROVIDER_LINKED_RECOVERY_ONLY=true; HISTORY_ENABLED=false e HISTORY_EXECUTION_ENABLED=false em Core/Worker/Provider. Envio/mídia já autorizados pelo usuário (SQLtrue) antes desta rodada, preservados sem ativação pelo Codex; canal permanece DISABLED por sessão parada. Novas conexões e preparação posterior exigem nova autorização de atendimento (defaultsfalse). Rollback usa imagem Provider nova compatível e overlay com gates fechados; nunca CP4.7/restauraçãoSignal/downgrade.

Seis relatórios em `~/homelab/deploy-records/wapphub-provider-web/20261012-whatsapp-link-simplification/`, incluindo manifests de CI/imagens/backups/restore/continuidade/smokes/recursos. Riscos: WhatsApp pode recusar sessão; remoção pelo celular é declaração humana explícita; retenção segura limitada a2sessões anteriores; nenhuma garantia de histórico integral. Validação visual e operações reais continuam exclusivamente do usuário no notebook. STATUS atualizado apenas com fatos publicados; B6 não homologado e atendimento real indisponível enquanto vínculo não for confirmado. Documentação final será integrada sem rebuild/restart.

## P0 vinculação bloqueada — EM_ANDAMENTO (12/10/2026, 18:35 UTC)

Retomada autorizada para correção/testes/integração/publicação técnica; nenhuma operação real de vínculo autorizada. Mains locais/remotos limpos Core460c698/Chat4bb18f1; runtime link-c90099b/link-dd731cb. Leitura de API/SQL/Vault: DISCONNECTED, linkedtrue, desiredfalse, attempts5, sem transporte; logoutUNCONFIRMED18:25Z com recibo durável. Último prepare_linkFAILED/PROVIDER_UNAVAILABLE após5 tentativas; zero PENDING/PROCESSING. Vault256 recibos/847 chaves/nenhuma aposentadoria/pairingAuthorization ausente. Guard Sessions.command recusa novos comandos no limite256 antes de validar versão; cliente Core mascara SESSION_COMMAND_LIMIT429, induz retry sem progresso. UI vence lastCheckedAt30s sem REST, perde reconciliação e pode conservar spinner de estado antigo. Cliente compartilhado apiRequest já limita GET a15s; hipótese de consulta infinita não confirmada. Spinner deriva de PENDING/PROCESSING persistido na UI sem reconciliação; SQL encerrou as15 recusas (3autorizações humanas ×5tentativas). Logs Provider confirmam15 SESSION_COMMAND_LIMIT. ALLOW_SESSION_CONNECT efetivo true via compose.chat-integration.yml, basefalse; linkedRecoveryOnlytrue. Nenhum ajuste de flag necessário. Preparação elegível requer declaração humana de remoção pelo celular. Evidências: 20261012-p0-link-reconciliation/ (material privado protegido). Correção mínima: rotação bounded de recibos para comandos com fencing monotônico, erro específico/permanente, metadados de operação e reconciliação REST limitada/timeout/isolamento, confirmação humana explícita. Produção ainda intacta.

### P0 — implementação e backup/restauração isolada

Logs sanitizados comprovam15 SESSION_COMMAND_LIMIT às solicitações humanas anteriores. Recibos SQL estão FAILED (sem pendências); logoutCOMPLETED/UNCONFIRMED corresponde à identidade durável no Vault. Não há motivo para UPDATE manual ou replay de comando. Implementada rotação256 somente com controlVersion/fencing; autorização sem versão conserva limite e erro permanente. DTO/OpenAPI aditivos trazem idade/tentativas/retry do outbox, sem migration. Chat implementa reconciliação30s/expiry/foco/online/visibilidade, coalescing/throttle10s/abort e proteção de versão/timestamp; consulta falha separada de comando, verificação manual e incerteza sem spinner infinito. Declaração de remoção por checkbox desmarcado. Nenhuma ação real executada. Testes focados59/59; suíte integral/CI pendentes. Backup fresco pre-p0-link-20261012-184029: MariaDB/Vault/configuração, hashes verificados; SQL restaurado em rede Docker internal isolada, migration12→12/Prisma/drift/legados/defaultfalse conferidos. Produção não alterada.

### P0 — VALIDADO_TECNICAMENTE, integração/publicação pendentes

Core133/133, Provider126/126, Chat325/325 (32arquivos), focadosChat59/59; lint/typecheck/build aprovados, Prisma12 migrations/drift sem novo desvio/OpenAPI gerado e validado. A suíte Core exercita SESSION_COMMAND_LIMIT permanente em1tentativa, leitura dos metadados do outbox e prepare_link sintético com256recibos; ProviderHTTP/HMAC testa sem versão429, declaraçãofalse409, versão válida/duplicata/evicted replay409/QR sintético, nenhuma rede WhatsApp. Chat reproduz pendingUNCONFIRMED→FAILED por REST sem realtime, erro de consulta/manualretry e incerteza com coalescing foco/online/visibilidade. Gates negativos de tenant/CSRF/RBAC/recuperação/pares/enviomídia/live/Demo preservados nas suítes integrais. Nenhum teste ignorado ou browser executado. Backup/restauração aprovados; próxima ação PR/CI/revisão/merge e imagens imutáveis. Sem alteração produtiva ou replay dos comandos humanosFAILED.

### P0 — INTERFACE_CORRIGIDA_PUBLICADA — AGUARDANDO_VINCULACAO_HUMANA

Publicação técnica12/10/2026 às18:50UTC, sem operação real WhatsApp. CorePR32/commit724ac5e→maine6aa1c6faea23abb88aa02246e611a640f752fa3; ChatPR23/commit345be42→main49bc91d2d4cbbdde84d55ecbb62fd21f223cacb8. Heads/mains CI verde133/133 Core,126/126 Provider,325/325 Chat (32arquivos), sem skip. Lint/typecheck/build/Prisma12/drift sem novo desvio/OpenAPI e imagem sintética de mídia aprovados. Árvore integrada idêntica à branch testada.

[CoreCI](https://github.com/uillaneduardo/wapphub-core/actions/runs/38293237398/job/114958080949), [ProviderCI](https://github.com/uillaneduardo/wapphub-core/actions/runs/38293237344/job/114958080761), [ChatCI](https://github.com/uillaneduardo/wapphub-chat/actions/runs/38293244419/job/114958103095).

Backup consistente pre-p0-link-20261012-184029: SQL521209bytes/SHA8f30e32dfcb8c05b954a325c6ad8be0ada985c377f1b5e42c6d98aa176cbc848; Vault622703bytes/SHA81162e1025b8ad0bb583fc37ff762378cff605245d876d865278f3df8a517ae4;10configs/chaves protegidas. Restauração SQL/Vault isolada sem redeWhatsApp/migration12→12/legados/defaultfalse/referências aprovada; imagemfinal sobre Vault real copiado preservou auth/Signal/recibos/história/attempts/termination com factory0. Nenhuma nova migration aplicada.

Imagens imutáveis wapphub-core:p0link-e6aa1c6, wapphub-provider-web:p0link-e6aa1c6, wapphub-chat:p0link-49bc91d. Core/Worker→Provider→Chat; seishealthy/readiness/HTTPS/SPA/ativos/metadadosOpenAPI/autenticação401/realtimeupgrade401/RedisPONG aprovados.3amostras/20s e leitura adicional, backlog/journal/pending0, semOOM/restarts/erros críticos apósready; Provider77MiB/512MiB. DB/Redis/demais apps não reiniciados. Hashes de dados administrativos/mensagens/contatos e auth/Signal/história/recibos/controlVersion preservados.

Sessão real DISCONNECTED/linkedtrue/desiredfalse/socketfalse/attempts5, logoutUNCONFIRMED/LOGOUT_TRANSPORT_UNAVAILABLE; preparationEligibletrue exige declaração explícita de remoção no celular, recoveryEligiblefalse. RetiredSessions0/pairingAuthorization ausente/847chaves preservadas. ALLOW_SESSION_CONNECT efetivotrue pelo overlay (basefalse), linkedRecoveryOnlytrue; nenhuma alteração operacional de flags. Envio/mídia por conexãofalse; gates históricosfalse; operaçãoPAUSED/requests1→1/mensagenshistóricas0→0/14falhaslegadas0novas; grant intacto.

A operação que aparecia pendente era prepare_link: falhou às18:25:47Z após5 recusasSESSION_COMMAND_LIMIT, já terminal antes da correção. Seus registrosFAILED foram preservados; não houve UPDATE manual, replay ou nova identidade gerada pelo Codex. Core agora conserva o erro específico para futuras recusas legadas e encerra em1tentativa; UI concilia resultado por REST, sem fechar por idade. Nenhum QR/logout/recover/preparação/envio/upload/consulta/fetch real executado.

Evidências completas: ~/homelab/deploy-records/wapphub-provider-web/20261012-p0-link-reconciliation/ (RELATORIO/DEPLOY/TESTES/BACKUPS/ROLLBACK/HOMOLOGACAO e manifests sanitizados; material privado700/600). Rollback preserva imagens anterioreslink-c90099b/dd731cb e oferece imagemProvider compatível+gatesfalse; nunca CP4.7 automático, restauraçãoSignal ou downgrade. Próximo passo humano: abrir Provedores, observarVincular/verificação limitada, confirmar remoção pelo celular somente se realizada e então autorizar a nova vinculação/QR. Homologação visual/funcional exclusivamente pelo usuário; WhatsApp não conectado e B5/B6 não concluídos. Encerramento documental segue PRs próprios sem rebuild/restart por texto.

## Piloto WappHub QA — EM_ANDAMENTO (12/10/2026)

Autorizada preparação administrativa idempotente/Prisma, correções indispensáveis e deploy técnico; sem QR/autenticação/envio/consulta de destinatário/histórico remotos pelo Codex. Mains Corec7e14a3/Chatecec233 limpos, runtime Core/Worker/Providerp0link-e6aa1c6/Chatp0link-49bc91d, seishealthy. Organização QA independente com Owner existente; supervisor/agent pendentes de identidades/e-mails legítimos, sem senhas fabricadas. Perfis oficiais reutilizados, nenhuma cópia de dados/auth/Signal antigos. Backend já suporta texto sem mídia; UI só oferece ativação conjunta, portanto ajuste mínimo no Chat. Ferramenta administrativa transacional reutilizará schema/RBAC/auditoria e create interno somente para registro criptografado vazio, sem socket ou QR. Nenhuma API pública/arquitetura nova. Backup/restauração isolada em20261012-qa-real-pilot/; testes integrais e CI antes da publicação/provisionamento final.

### QA — VALIDADO_TECNICAMENTE, CI/publicação/provisionamento pendentes

Core134/134, Provider126/126, Chat326/326, focoChat42/42. Lint/typecheck/build/Prisma12/drift sem novos desvios/OpenAPI aprovados. Um teste legado de teardown de sessão no Chat excedeu a espera inicial durante execução paralela; suíte completa reexecutada sem carga das outras suítes passou326/326, sem mudança de asserções/timeouts. Logs de ambas as execuções preservados. Teste QA atravessa CoreHTTP/session/CSRF→outbox→ProviderHMAC→Vault/journal→SQL/realtime com QR/auth/contatos/texto/recibos sintéticos; cria organização idempotente sob concorrência, testa rollbackSQL/readiness/RBAC e isolamento bidirecional, reinício sem QR e credenciais antigas intactas. Nenhuma rede WhatsApp real.

Baseline atual comprova sessão antigaFAILED/RECONNECT_LIMIT/attempts10/recoveryFailures5, último disconnect428, desiredtrue/grant de pairing antigo retido e sem socket, uma sessão aposentada criptografada e keys atuais0. Situação difere de relatório P0 após ações humanas; não tentar recuperar/resetar/apagar. Backup pre-qa-pilot-20261012-194023 SQL/Vault/configurações restaurado em isolamento; migration12→12/legados/integridade/defaultfalse e decriptação estrutural de Vault/registro aposentado aprovados, rede none. Owner existente único/ativo/autenticado; identificadores de provisionamento estáveis guardados em arquivo privado. Apenas Chat precisa de deploy; ferramenta Core será executada em container administrativo transitório versionado, sem restart de API/Worker/Provider/DB/Redis. Flags técnicas conexão/outboundtrue e gates históricosfalse já efetivos; nenhuma flag será ampliada. Perfis supervisor/agent preparados na matriz oficial, sem novos logins ou convites fictícios.


### QA — QA_PRONTO_PARA_VINCULACAO (12/10/2026, 20:11 UTC)

Piloto isolado preparado e publicado tecnicamente. Organização **WappHub QA** ACTIVE `da7fe7a3-9dd5-4b5a-8793-235028854df3`; canal próprio WHATSAPP_WEB `2026fa0e-f463-4bfd-9921-9eae1189cbd2`; Membership ACTIVE/OWNER `3dacca7b-f5e0-4bfd-80cd-e7b2288c3b1f` para usuário administrativo existente. Seu login/contexto atual não foi modificado. Listagem do caso de aplicação real Foundation.organizations e resolver de Membership confirmaram visibilidade no seletor/20 permissões oficiais. Supervisor16/Agent13 permanecem perfis oficiais reutilizados, sem providers.manage; memberships/logins/convites pendentes de identidades/e-mails reais. Nenhuma senha fabricada, conta global ou convite fictício. Nenhum endpoint público de criação foi inventado.

Core [PR34](https://github.com/uillaneduardo/wapphub-core/pull/34), commit21aed63a547b698237c174a05f2c3c440d8ee036 → main integrado236b1ffcf872e55a06a580c6bb0983942ab0041a. CLI explícito `scripts/qa-pilot.ts` reutiliza Prisma/transação, lock do administrador, Membership/RBAC, schema, auditoria e criação PUT assinada de registro criptografado ocioso. IDs estáveis guardados em private/qa.env e provision-input.json no registro local, nunca disparado por startup/Worker/browser. Executado duas vezes em imagem transitória wapphub-core:qa-admin-236b1ff, mesmo ID/Membership, createdfalse na segunda, uma auditoria de provisionamento e uma de preparação. Nenhum socket/QR/comando remoto. Não altera capabilities/dados em reexecução e rejeita conflitos/privilégios insuficientes/readiness indisponível.

Chat [PR25](https://github.com/uillaneduardo/wapphub-chat/pull/25), commitc1a5c3a7d96516864510dd42ec4c69efc9e59d44 → main integrado7ae2018db2cf624dd909f92ec30c8249e68aba83. Publicada imagem **wapphub-chat:qa-text-7ae2018**, OCI revision correspondente, com **Autorizar envio de texto** usando capability existente true/false e timeout/cancelamento. Apenas Chat recriado. API/Worker wapphub-core:p0link-e6aa1c6 e Provider wapphub-provider-web:p0link-e6aa1c6 mantidos, mesmos IDs/início; código de runtime/contratos/schema do main idêntico à imagem existente, portanto não houve restart desnecessário. MariaDB/Redis/demais aplicações preservados, nenhuma migration nova.

CIs dos heads e mains aprovadas: Core134/134, Provider126/126, Chat326/326 em32arquivos, lint/typecheck/build/Prisma12/OpenAPI/drift sem novos desvios. [CoreCI](https://github.com/uillaneduardo/wapphub-core/actions/runs/38301880863/job/114986507969), [ProviderCI](https://github.com/uillaneduardo/wapphub-core/actions/runs/38301880810/job/114986508095), [ChatCI](https://github.com/uillaneduardo/wapphub-chat/actions/runs/38301887171/job/114986529310). Teste QA atravessa HTTP/session/CSRF/Origin/outbox/HMAC/Provider/Vault/journal/SQL/realtime com QR/auth/contatos/E.164/texto/recibos sintéticos; concorrência/idempotência/RBAC/tenant bidirecional/restart e dados antigos preservados. Não houve browser gráfico/WhatsApp real; teste local Chat legado falhou sob carga inicial e passou na repetição integral sequencial e nas CIs, sem asserções/timeouts alterados.

Backup pre-qa-pilot-20261012-194023: SQL528532 bytes/SHA256e926d5117a0635943cba6f39a92ea3b31f8a3765f18d1d30b847dfa98c74bedd; Vault625087 bytes/SHA2568c901831ab345758bdf7bd9b00acdd1b8539abf36b17a1242a969b730a6eec0b;10configs/chaves protegidas. DB realmente restaurado em MariaDB isolada/rede internal/schema12→12/integridade/legados/defaultfalse/Prisma/drift aprovado. Vault extraído e decriptado estruturalmente em networknone, sem factory/socket, registro aposentado intacto. Manifest/hashes revalidados antes da publicação. Rollback Chat preservado p0link-49bc91d; não exige restart backend, downgrade ou restoreSignal.

QA: DISCONNECTED/erro nulo, lastCheckedAt recente pelo Worker, pairingEligibletrue/linkedfalse/desiredfalse/attempts0/sem auth ou Signal/grant/sockets. Canal DISABLED até vínculo; envio/mídiafalse. Zero contatos/conversas/mensagens/tags/notas/Inbox/comandos/convites QA. Owner pode selecionar QA e clicar Vincular WhatsApp; não depende de terminal para iniciar QR. Sessão antiga FAILED/RECONNECT_LIMIT/attempts10/recoveryFailures5/sem transporte, referências/auth/Signal aposentados/história/recibos/fencing/tentativas preservados. Hashes das8tabelas de domínio protegidas idênticos. Solicitações históricas1→1, mensagens históricas0→0. ALLOW_SESSION_CONNECT efetivotrue pelo overlay existente (basefalse), linkedRecoveryOnlytrue, suporte outboundtrue nos3serviços, gates históricosfalse, flags perconnection false em ambas. Nenhuma mudança de flag ou grant, recuperação real, QR/connect, logout/prepare_link, consulta/envio/upload/fetch remoto pelo executor.

Seishealthy/readiness, HTTPS/SPA/ativos/ação no bundle/OpenAPI, proteção401 REST/realtime, RedisPONG, journal/backlog/pending0, sem OOM/restarts/padrões críticos na observação. Evidências: `~/homelab/deploy-records/wapphub-provider-web/20261012-qa-real-pilot/` — RELATORIO/DEPLOY/TESTES/BACKUPS/ROLLBACK/HOMOLOGACAO, ci-pr/main.json/logs, qa-readonly.json, continuity.json, images.json e snapshots. Material sensível só private700/600.

Próximo passo humano: login existente → selecionar WappHub QA → Configurações/Provedores/WhatsApp/Vincular WhatsApp → ler QR no celular → aguardar Conectado → Configurar atendimento/Autorizar envio de texto → Inbox/Nova conversa por número controlado com DDI → enviar1texto manualmente e observar no celular/status/autoria/resposta. Mídia/histórico adicional fora do aceite inicial. Nenhuma homologação humana presumida; B6 pendente, B5 da sessão antiga não concluído. Documentação final não requer nova imagem/restart.


## P0 primeiro pareamento QA — EM_ANDAMENTO (12/10/2026)

Autorizado diagnóstico/correção/testes/CI/merge/deploy, sem QR/recover/logout/envio/consulta/histórico real pelo Codex. Mains Core187f372/Chat5b8c127 limpos; runtime Core/Worker/Providerp0link-e6aa1c6 e Chatqa-text-7ae2018, seishealthy. QA tem connectCOMPLETED em22:10:38Z,1tentativa no outbox, controlVersion3; Provider abriu5transportes e recebeu close428 antes de qualquer QR/auth, terminandoFAILED/RECONNECT_LIMIT/attempts5/recoveryFailures5/desiredtrue/grant de pairing retido/sem socket/qrRevision0/sem identidade autenticada. Core/realtime/REST refletem esse estado, zero comandos pendentes. Organização antigaFAILED10 intacta. Flags efetivasALLOW_SESSION_CONNECTtrue/linkedRecoveryOnlytrue, nenhuma liberação operacional necessária. DNS/TLS público validado sem WebSocket/autenticação; certificado válido. Baileys7rc14 fixado, default de versão igual à fonte oficial atual; não há evidência para upgrade ou troca de versão. Logger SDK silent não conserva motivo específico da interrupção428; não presumir sessão revogada ou QR disponibilizado.

Correção mínima proposta: separar primeiro pareamento (CONNECTING/GERANDO_QR, prazo e autorização delimitados, falha terminal sem loop) da reconexão autenticada (backoff/budgets existentes); não gastar/resetar recoveryFailures em sessão sem identidade; manter attempts histórico. Permitir novo gesto versionado com elegibilidade recente após erro legado sem vínculo, preservar logout/revogado/substituído/fencing. Diagnóstico de transporte estritamente sanitizado, sem QR/erros brutos. Testes sintéticos devem percorrer SDKFactory/HTTP/HMAC/Vault/Core/outbox/REST/Chat e primeira autenticação/restart515. Evidências em20261012-p0-first-pairing/. Nenhuma produção alterada nesta auditoria.


### P0 QR — correção e validação em andamento

Sessions distingue presença de identidade autenticada da primeira vinculação. Primeiro pareamento mantém CONNECTING/GENERATING_QR, prazo específico30s para disponibilizar QR e limite total120s do gesto; erro encerra desired/grant/socket sem ciclo automático. QR válido revisado/20s só dentro da autorização; cancelamento/stop/fencing/tenant preservados. attempts continua histórico, recoveryFailures não é consumido nem zerado em pareamento; reset somente após open autenticado+30s estáveis, como já existia. Após scan,515 permite uma única conclusão autenticada dentro do mesmo prazo, com allowPairingfalse e sem novo QR; outro fechamento termina o episódio. Restart não repete pareamento; FAILED/grant expirado conserva causa/recibos e interrompe intenção de rede. Core admite nova autorização quando lifecyclepairingEligibletrue/linkedfalse foi confirmado há menos de30s, inclusive após RECONNECT_LIMIT legado; revogado/substituído/BAD_SESSION permanecem bloqueados. Chat apresenta erro compreensível e botão contextual para novo gesto.

SDK handlers de credentials/connection são registrados antes de aguardar importador local. Diagnóstico mapeia somente enumerações e códigos numéricos, nunca mensagens brutas/QR/auth/Signal. Consulta pública de sw.js, sem WebSocket ou conta, comprovou revisão1050063423 versus defaultSDK1043857760. Pin operacional opcional PROVIDER_PAIRING_WEB_VERSION=2,3000,1050063423 é aplicado apenas ao primeiro pareamento autorizado; sem consulta no startup, upgrade de SDK ou alteração de configuração das sessões autenticadas. A divergência é comprovada, mas sua causalidade para428 continua uma hipótese; relato primário Baileys2691 descreve428 mesmo com revisão atual, portanto não prometer cura remota. SDK7rc14 continua travado.

Testes Core134/134 e schema12/Prisma/OpenAPI/drift sem novos desvios aprovados; Provider135/135 antes do pin e10/10 focados finais, integral final com pin em execução. Chat331/331/32arquivos, foco62/62, lint/typecheck/build aprovados. Um teste legado de teardown falhou sob carga concorrente e passou na repetição sequencial integral sem alterar asserções/timeouts; duas saídas preservadas. Testes de reconexão/revogação agora utilizam identidade sintética explícita; asserções de limite/backoff/fencing/credenciais mantidas. Backup pre-first-qr-20261012-222734: SQL531795bytes/Vault627835bytes/10configs, hashes verificados, SQLrestaurado em redeinternal/migration12→12/legados/defaultfalse aprovados. A imagem final ainda precisa provar startup sobre cópia real do Vault sem factory/rede antes do deploy. Produção intacta; nenhuma tentativa real pelo executor.


## P0 primeiro pareamento QA — PUBLICADO (12/10/2026, 22:45 UTC)

**QA_AGUARDANDO_NOVA_TENTATIVA_DE_QR.** [Core PR35](https://github.com/uillaneduardo/wapphub-core/pull/35): funcional `03853d26f28edda5e91e95238df65fcc5085e448` → main/imagem `686a85256fb93cad48d6ec677675b40ea5474f62`. [Chat PR26](https://github.com/uillaneduardo/wapphub-chat/pull/26): funcional `62d21e05f2568f67f154e63d258ad2d6e8fc0519` → main/imagem `0a5875399a2cabb5e6a0633fa67d9448829f514a`. Sem dependências/schema/migration/contrato OpenAPI novos. Documentação pós-publicação não requer nova imagem nem restart.

### Causa comprovada e limites do diagnóstico

A tentativa humana QA abriu cinco sockets; todos fecharam com 428 antes de QR ou identidade autenticada. A implementação confundia falha do primeiro pareamento com recuperação autenticada, exibindo RECONNECTING, consumindo recoveryFailures e bloqueando nova autorização no Core ao atingir RECONNECT_LIMIT. O connect COMPLETED comprovava execução administrativa, não QR/autenticação. Sem comandos pendentes; flags efetivas ALLOW_SESSION_CONNECT=true/linkedRecoveryOnly=true já permitiam o gesto inicial. DNS/TLS público disponível. SDK silent não conservou motivo específico do fechamento 428: não reconstruível, não presumir revogação ou causa de rede.

Sessions agora mantém CONNECTING/GENERATING_QR antes da identidade, timeout específico de geração 30s e autorização total 120s, valida QR/revisão/prazo, e encerra falhas sem loop ou reset de contadores. Tentativa seguinte depende de novo gesto idempotente/versionado e elegibilidade fresca por organização. Core admite legado RECONNECT_LIMIT somente quando unlinked/pairingEligible comprovado recentemente; sessão revogada/substituída/corrompida continua bloqueada. Após scan, um único fechamento 515 pode concluir autenticação dentro da mesma autorização, com allowPairing=false, sem novo QR; segunda falha termina. Restart não repete autorização expirada/interrompida. Diagnóstico limitado a códigos/enumerações, sem QR/erros brutos/auth/Signal. Chat apresenta mensagem clara e uma ação contextual.

Pin operacional PROVIDER_PAIRING_WEB_VERSION=2,3000,1050063423 corresponde à revisão pública observada e aplica-se somente a primeiro pareamento autorizado, sem consulta no startup/alteração de sessões autenticadas/upgrade de SDK. A divergência com o default SDK é demonstrada; sua causalidade para 428 não é. Só a nova tentativa humana pode comprovar disponibilidade remota do QR. Fontes/evidências no relatório.

### Validação final e integração

Local e CI dos heads/mains: **Core134/134, Provider136/136, Chat332/332 em32arquivos**, lint/typecheck/build/Prisma12/OpenAPI/drift sem novas diferenças. [Core CI](https://github.com/uillaneduardo/wapphub-core/actions/runs/38318034413/job/115039253071), [Provider CI](https://github.com/uillaneduardo/wapphub-core/actions/runs/38318034409/job/115039253176), [Chat CI](https://github.com/uillaneduardo/wapphub-chat/actions/runs/38318040178/job/115039272137). Dez casos focados novos atravessam factory SDK/Vault/QR/HMAC e primeira autenticação/restart515; integração Core atravessa sessão/CSRF/Origin/outbox/Provider/SQL/realtime com isolamento QA/antiga, comando duplicado, retries explícitos e estados incertos. Reconexão autenticada/revogação/envio/mídia/histórico/Demo preservados. Fixtures legadas receberam identidade autenticada explícita para testar sua semântica, sem reduzir asserções de limite/backoff. Uma execução Chat sob carga falhou em teste legado de teardown; repetição integral sequencial e CI final aprovaram sem alterar asserções/timeouts. Logs de falha e sucesso preservados; não há teste obrigatório pendente.

### Backup, publicação e verificação

Backup `pre-first-qr-20261012-222734`: SQL531795bytes/SHA256 `c49b94ce095322929616883a68b7f05d777d4249d8a83a045a9a1ee1b713a78e`; Vault/cache627835bytes/SHA256 `b6466542f690b64b3d7c41daca9b17913d92e423c8ed51c7b12f23a410d9d225`;10configs/chaves privadas protegidas. Restauração real MariaDB isolada/rede internal/schema12→12/integridade/defaultfalse/Prisma/drift aprovados. Imagem final sobre cópia real criptografada do Vault em networknone: factory0, material de auth/Signal/aposentados/recibos/fencing/checkpoints/contadores igual, estados terminais mantidos. Hashes/configuração/CI verificados antes da publicação.

Publicado somente Provider `wapphub-provider-web:firstqr-686a852` → API `wapphub-core:firstqr-686a852` → Chat `wapphub-chat:firstqr-0a58753`, entre22:44:44 e22:45:10UTC. Worker `p0link-e6aa1c6` permanece compatível: nenhuma mudança em processamento/outbox/ingestão, sem restart. MariaDB/Redis e37outros containers mantêm IDs/início, nenhuma migration. Imagens anteriores preservadas. Rollback de UI pode usar qa-text-7ae2018; Provider antigo não deve ser restaurado automaticamente porque repetiria a política incorreta. Contingência backend mantém imagem Source nova compatível e desabilita capacidades/connect; preparada, não executada, sem restoreSignal/downgrade.

Seishealthy/APIready/HTTPS/SPA/assets/OpenAPI/RedisPONG/realtime401, Worker reconcilia estado recente, journal/backlog/pending0, sem OOM/restarts/erros críticos/sockets novos na janela observada. QA permanece FAILED/RECONNECT_LIMIT/attempts5/recoveryFailures5/qrRevision0, linkedfalse/sem identidade/sem transporte, mas **pairingEligibletrue/desiredfalse**. Organização anterior FAILED/RECONNECT_LIMIT/attempts10 preservada. Startup interrompeu as duas intenções de pareamento expiradas, sem nova rede; grants expirados/causas/recibos/counters/auth/Signal mantidos para diagnóstico. Oito tabelas protegidas iguais antes/depois; QAcontatos/conversas/mensagens/tags/notas/convites0, **1connectCOMPLETED e10connection.updated preexistentes** iguais. O harness inicial de smoke esperava Inbox0 por baseline do piloto anterior; corrigido para comparar todos os valores reais desta execução, antes==depois, sem excluir asserções. Esse foi erro de expectativa de evidência, não falha da publicação.

Flags ALLOW_SESSION_CONNECTtrue/linkedRecoveryOnlytrue e suporte outbound técnico mantidos; capabilities envio/mídiafalse nas duas conexões, gates históricosfalse. Requests históricos1→1, mensagens históricas0→0. **Nenhum QR/connect/recover/logout/prepare_link/envio/upload/consulta de destinatário/fetch real pelo Codex.** Diagnóstico público HTTP/TLS não usou socket, conta ou autenticação WhatsApp. Não há comprovação de conexão real QA ou homologação B6.

Evidências verificáveis em `~/homelab/deploy-records/wapphub-provider-web/20261012-p0-first-pairing/`: RELATORIO/DEPLOY/TESTES/BACKUPS/ROLLBACK/HOMOLOGACAO, integration.json, ci-main.json/logs, backups.json/restore-result.json/vault-startup-final.json, postdeploy.json/qa-after.json/qa-events-commands-after.json/http-smokes.json. Material sensível somente private700/600.

Próximo passo humano: selecionar WappHub QA → Configurações → Provedores → WhatsApp → clicar **Vincular WhatsApp** uma única vez. Aguardar QR/autenticação no navegador/celular; antes de identidade não deve aparecer Reconectando. Se faltar QR ou transporte encerrar, erro terminal verificável sem loop; informar somente código/horário, não QR/segredos. Teste real de texto fica para depois de CONNECTED confirmado e habilitação explícita pelo Owner. B5 da sessão antiga não concluído e B6 não homologado.


## Auditoria da regressão QR real — EM_ANDAMENTO (13/10/2026)

Autorizado diagnóstico/correção/CI/merge/backup/deploy, sem solicitar QR, pareamento, recovery/logout/preparação, envio/consulta/histórico real. Mains Core8d9b2c6/Chatb5f60d5 limpos e iguais ao remoto. Runtime API/Providerfirstqr-686a852, Chatfirstqr-0a58753, Workerp0link-e6aa1c6; seishealthy. QA após quatro novos gestos humanos: FAILED/PAIRING_TRANSPORT_CLOSED/attempts9/recoveryFailures5/qrRevision0, sem identidade autenticada/Signal/socket, desiredfalse/pairingEligibletrue, cinco commandsCOMPLETED e18eventosconnection.updated, sem pendência. Organização anterior FAILED10/auth aposentada preservada. Flags ALLOWtrue/linkedOnlytrue/pin2,3000,1050063423/histórico remotofalse/capabilitiesfalse inalteradas. Evidências20261013-qr-regression/; nenhum dado operacional alterado.

Último evento real comprovado: SOCKET_CREATED → WS_OPEN → WS_CLOSED/TRANSPORT_WS_CLOSED em menos de um segundo; lastDisconnect428, nenhum QR_REQUIRED/qrRevision. Callbacks registrados antes do importador local; QA não possui operação histórica, recover do importador é no-op, sem indício de espera120s/timeout/cancelamento local antecedendo a queda. REST/Worker/realtime atualizam a falha recente e recibos corretamente. Handshake específico não era observável com logger SDK silent: não afirmar que registro foi aceito.

Git49c2252a5c80075d598588b2f299ed56e0fc2a08 introduziu browsermacOSDesktop + syncFullHistorytrue exclusivamente no primeiro pareamento. Sessão real anterior CP3/CP4 tinha QR revision2, identidade/Signal e CONNECTED comprovados sob padrãoSDKmacOSChrome/Web. Inspeção do SDKrc14 e projeção offline do payload usando credenciais reais QA somente por leitura comprovam mudança WEB_BROWSER/CHROME → DARWIN/DESKTOP, mantendo userAgentWEB; remover overrideDesktop restaura WEB_BROWSER/CHROME inclusive com syncFullHistorytrue. Fonte primária Baileys2677 relata exatamente428/200–600ms/antesQR no caminhoDarwin, com WebBrowser funcionando sob mesma revisão/rede. Isso identifica uma regressão de configuração concreta; a causalidade remota neste ambiente e o QR ainda exigem novo gesto humano depois do deploy. Sem atualização aleatória de versão/SDK/credenciais.

Correção mínima: retirar overrideDesktop mantendo bootstrap limitado, gates/Vault/outbox/fencing; substituir silêncio opaco do SDK por projeção estrita de etapas sem argumentos/payloads/segredos, incluindo handshake/registração/offer/QR/fechamento local e correlação técnica de escopo. Verificar possível perda de reconciliação REST quando um evento realtime chega durante leitura coalescida; alterar Chat somente se defeito demonstrado no fluxo existente. Executar suítes existentes, sem nova bateria de QR fictício, backup/restauração/imagens e smokes somente leitura; homologação real exclusiva do usuário.


### Regressão QR — VALIDADO_TECNICAMENTE, aguardando CI/integração (13/10/2026)

Provider136/136, Core134/134 e Chat332/332 existentes, lint/typecheck/build/Prisma12/OpenAPI/drift sem novos desvios aprovados. Nenhum novo cenário de QR fictício ou aumento de contagem; assertivas existentes reforçadas com payload real do SDK e privacidade/corridaREST. Execução inicial Chat331/332 identificou fixture enviando evento ao socket antigo após online/retry; corrigida para socket atual, foco44/44 e integral332/332 aprovados. Não removidas asserções ou limites/timeouts. Logs de falha/sucesso preservados.

Backup pre-qr-regression-20261013-035908: SQL535958bytes, Vault629278bytes, hashes/configs privados em manifest. SQLrestaurado em MariaDB/networkinternal isolados, schema12/migration/drift/legados/defaults aprovados; nenhum SQL/migration em produção. Container/network temporários desta restauração removidos, demais ambientes preservados. Startup da imagem final ainda é gate antes de publicar.

Compatibilidade: função pública oficial fetchLatestWaWebVersion do Baileysrc14 instalado retornou2,3000,1050149611/isLatesttrue, somente HTTP de metadados sem conta/socket/QR. Pin operacional anterior1050063423 será atualizado para revisão comprovada nesta publicação, apenas no escopo de novo pareamento explicitamente autorizado. SDK/dependências e configuração de transportes autenticados mantidos; nenhuma descoberta de versão automática. Regressão Desktop concretamente demonstrada; não afirmar que pin ou testes comprovam aceitação remota. PRs restritos a Provider/Chat; CoreAPI/Worker/DB/Redis devem permanecer sem restart.


### Regressão QR — PUBLICADO, AGUARDANDO_HOMOLOGACAO_REAL (13/10/2026)

**CORRECAO_PUBLICADA — AGUARDANDO_HOMOLOGACAO_REAL.** [Core PR36](https://github.com/uillaneduardo/wapphub-core/pull/36):05c6e9f6a7c43d2e184bbfddb4e8a030b49237ab →06fafb659999a1155555180b0c6b70ca54c5bf32. [Chat PR27](https://github.com/uillaneduardo/wapphub-chat/pull/27):0dbcdbe8d2a478bb275e18897633da8eb3a2308b →dbab1aec709b9a3026079ad3dbce1d2dabfd7192. CI heads/mains Core134/134, Provider136/136, Chat332/332, lint/typecheck/build/Prisma12/OpenAPI/drift sem novos desvios, trees merges idênticas aos heads. [CoreCI](https://github.com/uillaneduardo/wapphub-core/actions/runs/38345301357/job/115125203127), [ProviderCI](https://github.com/uillaneduardo/wapphub-core/actions/runs/38345301426/job/115125203423), [ChatCI](https://github.com/uillaneduardo/wapphub-chat/actions/runs/38345304553/job/115125213811). Nenhuma nova bateria/cenárioQR fictício ou homologação por mocks.

Backup `/home/uillan/homelab/backups/wapphub-consolidation/pre-qr-regression-20261013-035908`: SQL535958bytes/SHA256`69c8b952627e16c120baa547aeb950ed826d33007a713a7a0fd62de7d15fdf96`; Vault/cache629278bytes/SHA256`b2d48a9ad53a358a76e199c36a0450863e8fce1bd2e818215e5ed84c9dec877c`;10configs/chaves privados e manifest revalidados. SQL realmente restaurado em MariaDB isolada/redeinternal/schema12→12/legados/defaults/Prisma/drift aprovados, sem SQL/migration produtivo. Imagem final sobre cópia real criptografada do Vault em networknone preservou dois estadosFAILED e auth/Signal/retired/receipts/history/counters/fence, factory0/QR0. Restauração isolada temporária removida; dados produtivos não restaurados.

Publicado **somente Provider `wapphub-provider-web:qrfix-06fafb6` → Chat `wapphub-chat:qrfix-dbab1ae`**, entre2026-10-13T04:16:03.860452+00:00 e2026-10-13T04:16:17.398626+00:00, imagens imutáveis/revisions correspondentes. APIfirstqr-686a852/Workerp0link-e6aa1c6/DB/Redis e38outros containers preservados com mesmos IDs/início; nenhum comportamentoCore/Worker alterado. Schema12/contratos/dependências mantidos. ALLOWtrue/linkedOnlytrue/gates históricosfalse/suporte saída/mídia técnico mantidos; capacidadesfalse nas duas conexões. Única mudança operacional é pin público verificado1050149611 somente no primeiro pareamento autorizado.

Smokes/observação: seishealthy/APIready/HTTPS/SPA/deeplinks/assets públicos byte-idênticos à imagem/401REST/realtime protegido/RedisPONG/Core→ProviderHMAC/Worker/lastCheckedAt recente/journal/backlog/pending0, sem socket/QR/comando novo/OOM/restarts/erros críticos. ProbePythonurllib403 no ingresso, curl200 consistente nas rotas/assets; limitação do cliente de diagnóstico registrada, sem flexibilizar segurança do ingresso. Organização/canal/Owner/Membership/permissõesQA iguais; oito tabelas protegidas e credenciais/Signal/aposentados/recibos/fencing/history/counters iguais. QAcontacts/conversations/messages/tags/notes/invites0, commands5→5/Inbox18→18, attempts9→9/recoveryFailures5→5/qrRevision0. ContinuaFAILED/PAIRING_TRANSPORT_CLOSED/sem auth/socket, mas pairingEligibletrue/desiredfalse e ação principal autorizável. Organização antigaFAILED10 intacta; histórico1→1solicitações/0→0mensagens, nenhum grant reativado. Nenhuma transição de credenciais ou autorização durante deploy.

Runtime confirma browserWeb/Chrome padrão, overrideDesktop ausente, logger filtrado/etapas disponíveis e pin atual. Causalidade remota exata continua dependente do novo gesto humano: diagnóstico anterior só comprovava WSopen→close428 antes de qualquer QR. [Auditoria completa](WHATSAPP_WEB_QR_REGRESSION.md) mapeia todas as camadas, regressão49c2252, evidência histórica real e pontos de diagnóstico futuros. Sem arquitetura/Provider/filas paralelos.

Rollback preparado, não executado: Chat anterior preservado; Provider antigo reintroduz Desktop e não é reversão funcional automática. Contingência mantém Source final compatível com gates fechados, sem restoreSignal/downgrade/reset. **Nenhum QR/connect/recover/logout/prepare_link/pareamento/envio/upload/consulta/fetch real pelo Codex**, somente HTTP público de metadados. Homologação visual/funcional no notebook exclusiva do usuário; não QR_HOMOLOGADO/B6 concluído.

Evidências verificáveis em `~/homelab/deploy-records/wapphub-provider-web/20261013-qr-regression/`: RELATORIO/DEPLOY/TESTES/BACKUPS/ROLLBACK/HOMOLOGACAO, baseline/source-events-before/commands-before/protocol-projection/runtime-sdk/integration/ci-main/images/deploy-result/postdeploy/qa-after/public-bundle/qa-identity-preservation/backups/restore-result/vault-startup-final.json e logs. Segredos apenas private/backup700/600. Documentação final não requer imagem ou restart.

Próximo gesto humano: abrir chat.wapphub.com.br → selecionar WappHub QA → Configurações/Provedores/WhatsApp → Vincular WhatsApp uma única vez → visualizar QR real → escanear pelo celular → aguardar Conectado confirmado. Se falhar, informar somente código/horário; scopeHash/geração/etapas dos logs publicados permitem localizar handshake/frame/registro/offer/QR/persistência/finalização sem reconstruir tentativas anteriores. Não acionar logout/clear/recovery como workaround.

### 2026-10-13T13:01:32Z — assinatura automática — A0/A1 e início A2

Estado desta entrega: `A0/A1 AUDITADOS — A2 EM_ANDAMENTO`. Autor: Codex no
homelab. Escopo solicitado: assinatura automática do atendente em saída WhatsApp
Web, testes sintéticos e proposta mínima antes de implementar. Deploy e envios
reais expressamente excluídos; autorizações de entregas anteriores não são
reutilizadas para esta publicação.

Base limpa ao iniciar: Core `main` local/remoto
`701f634e545898c4690e9b01241938dc9266f821` (confirmado por `git ls-remote`).
Branch documental: `docs/a2-attendant-signature-20261013`. AGENTS, documentos
mandatórios, contrato de execução/progresso e relatório local QR lidos; fonte,
outbox, Worker, deduplicação/eco e adapter instalado inspecionados.

Produção conferida por Docker/labels/Compose e consultas SQL somente leitura:
API `firstqr-686a852`, Worker `p0link-e6aa1c6`, Provider `qrfix-06fafb6`, Chat
`qrfix-dbab1ae`; seis serviços WappHub healthy. Arquivos solicitados e `web-sync.ts`
idênticos em Git entre main e revisões da API/Worker; hashes dos três artefatos
compilados solicitados também iguais entre API e Worker. Divergências de código
em main se concentram no pareamento/diagnóstico do Provider, não no envio Core.

Leitura atual às 13:00Z supera o baseline histórico de 04:42Z: uma conexão
`CONNECTED` com outbound/media habilitados e outra `FAILED` com capacidades
desabilitadas; dez comandos send preexistentes (oito COMPLETED, dois FAILED),
nenhum comando PENDING/PROCESSING e zero mensagens históricas. Gates globais
Core/Worker: web/outbound/media true, execução histórica false. Esses dados
não comprovam homologação do usuário nem autorizam operações reais pelo Codex.
Não foram lidos/expostos corpos, nomes de usuários, telefones, QR ou credenciais.

Achado que amplia minimamente o diff: `web-sync.ts` compara eco remoto com
`Message.body`; após assinar, o eco contém `transmittedBody` e seria rejeitado.
A2 incluirá comparação estrita com o texto transmitido somente para saída já
persistida com autoria interna, sem reescrever corpo/autoria/histórico.

Baseline sintético executado nesta rodada: `tsx --test
tests/provider-contract.test.ts`, **9/9 aprovados**, Node22.22.1, sem DB/Provider
real. Ainda não há implementação nem testes novos da assinatura. `STATUS.md`
mantido porque esta fase não publica nem homologa funcionalidade. Próxima ação:
finalizar proposta A2 e solicitar uma aprovação conforme AGENTS/contrato.

### 2026-10-13T13:04:56Z — assinatura automática — A2 concluída para revisão

Estado desta entrega: `AGUARDANDO_APROVACAO_A2`. Proposta concreta em
[WHATSAPP_WEB_ATTENDANT_SIGNATURE.md](WHATSAPP_WEB_ATTENDANT_SIGNATURE.md),
incluindo comparação main/runtime, achado do eco, matriz de requisitos/testes,
normalização, snapshot, limite contratual e rollback compatível com a fila.
Diff funcional previsto: helper pequeno na application + criação Web em
`chat.ts` + comparação de eco em `web-sync.ts`; Worker e contrato outbound
existentes não precisam de mudança funcional. Assinaturas e legendas usam
User.name autorizado e transmittedBody persistido, sem alterar body/senderName.

Mudanças desta rodada são exclusivamente os dois documentos desta proposta;
nenhum código/teste novo, commit/push/PR/merge, deploy, restart, migration,
pareamento ou envio real foi executado. Baseline contratual9/9 e
`git diff --check` aprovados; demais gates e testes novos serão executados após
aprovação, sem alegar implementação/homologação. STATUS permanece intacto.
Próxima ação: uma aprovação do usuário desta A2, como exigido pelo AGENTS e
contrato de execução; após ela, implementar/testar sem microaprovações técnicas.

### 2026-10-13T14:03:32Z — assinatura automática — A2 aprovada, B2/B4 em andamento

Usuário aprovou expressamente A2 e autorizou implementação/testes conforme
WHATSAPP_WEB_ATTENDANT_SIGNATURE.md. Requisitos adicionais reforçam preservação
de autoria/IDs, snapshot em retries/rename, limite8000 final, normalização,
eco sem duplicatas/conflitos mascarados e exclusão de outras origens.
Sem autorização para deploy, migrations produtivas, pareamento/envios reais.
Branch documental e alterações anteriores preservadas; base701f634 inalterada.
Docker conferido: seis serviços produtivos healthy, mesmas imagens/inícios da
auditoria; ambiente wapphub-m1-test separado disponível. Próxima ação: helper,
criação Web, comparação estrita de eco e testes sintéticos; sem alterar provider
ou contrato outbound desnecessariamente.

### 2026-10-13T14:15:41Z — assinatura automática — B2 implementada, B4 finalizando

Diff funcional mínimo implementado no helper/application Chat e na comparação
de eco WebSync. Worker/contratos/DTOs/schema/provider produtivo intactos.
Provider137/137, lint/typecheck/build aprovados. Core integral142/142 e
lint/typecheck/build/OpenAPI/Prisma12/drift aprovados em primeira validação final.
Adicionados depois um teste de fila legada sem assinatura e a asserção negativa
de eco histórico divergente; nova rodada integral Core/checks finais em execução.

Correção da premissa A2: código instalado Zod4.6.5 mede max8000 em code points
Unicode; o helper reutiliza o validador existente e os testes de 8000/8001 com
emoji foram corrigidos, sem mudar contrato ou aceitar mais que8000caracteres.
Falhas preliminares: filtro focado omitia o teste que cria channelId; fixture
Media não tinha id obrigatório; tipagem do helper SyncItem precisava retornar
variante message. Todos corrigidos ou invocação corrigida sem retirar asserções.
core-web-first.log preserva45/46 antes da correção da fixture, core-full.log
preserva142/142 posterior; não houve falha funcional ocultada ou mudança de
timeout/limite. Ambiente de teste separado/schema_test; nenhuma migration
necessária (12 já aplicadas), nenhuma ação produtiva ou envio real pelo executor.

### 2026-10-13T14:20:18Z — assinatura automática — B2/B4 validadas localmente

Estado: `VALIDADO_TECNICAMENTE_LOCAL — EM_REVISAO`. Core final143/143,
Provider137/137, nenhum skip/falha; lint/typecheck/build dos dois pacotes
aprovados. OpenAPI idêntico/Prisma válido/12 migrations já aplicadas no schema
isolado/zero novo drift; cinco diferenças legadas de FK intactas. Diff check
aprovado. Corpo/senderName/autoria/IDs originais conservados, snapshot usado
em rename/retry, limite final8000codepoints, texto/legendas/eco strict/conflictos
e tenancy provados por testes sintéticos. Assinatura não aplicada em internos,
Demo, recebidos/DEVICE/históricos ou fila legada. Worker/contrato/schema intactos.

Evidências em `~/homelab/deploy-records/wapphub-provider-web/20261013-attendant-signature/`:
core-full-final.log143/143, provider-full.log137/137, core-checks finais,
core-contract-schema.log; primeiras falhas e sucesso142/142 preservados.
Revisão manual do diff funcional/conflitos concluída. Produção às14:19:21Z:
seiscontainers healthy, IDs/imagens/StartedAt iguais ao início da implementação;
nenhum serviço produtivo reiniciado/reconfigurado e nenhuma migration nova.

Documento da entrega atualizado com comportamento/validação/riscos/rollback;
STATUS recebe apenas ponteiro informativo da alteração local em revisão, sem
substituir registros publicados ou afirmar homologação. Próxima ação: commit/PR
de revisão e CI conforme fluxo do repositório, sem merge/publicação automática.
Deploy, migrations em produção, pareamento/envio real e homologação humana
permanecem fora da autorização desta implementação.

### 2026-10-13T14:22:30Z — assinatura automática — PR de revisão e CI

Branch renomeada para `feat/whatsapp-attendant-signature`, commit funcional
`57bf2becd27c602a2670834d8e39e23eada29ada`, push concluído e workspace limpo.
[PR37](https://github.com/uillaneduardo/wapphub-core/pull/37) aberta como draft
para revisão, base701f634/main, nove arquivos; nenhum merge automático.
CI disparada Core38412743642/Provider38412743865, em andamento neste registro.
Commit documental subsequente registra esses links e a retomada; conferir
checks do head final antes de eventual integração. Resultados remotos finais
serão preservados no relatório local e comunicados na entrega, sem executar
publicação ou homologação. Testes/checks locais143/143+137/137 já encerrados.

### 2026-10-13T14:40:39Z — PR37 revisão final de legenda em branco — início

Usuário autoriza verificar/corrigir somente comparação de eco de mídia com
autoria local, criar testes de whitespace/eco sem legenda/eco preservado/texto
divergente/preservação/legados e repetir checks/CI. Provider/abstrações fora do
escopo; PR deve permanecer draft e deploy proibido. Branch limpa
feat/whatsapp-attendant-signature/d7f37f9 conferida; seis containers produtivos
healthy com IDs/imagens/StartedAt iguais à entrega anterior. Comparação atual
normaliza somente string vazia para null, deixando whitespace versus ausência
de legenda em conflito. Próximo: reproduzir em testes sintéticos, correção
restrita e validação em wapphub_m1_test/CI, sem operação WhatsApp real.

### 2026-10-13T14:44:33Z — PR37 legenda em branco — correção e regressão

Reproduzidos dois conflitos reais em testes (snapshot corrente e fallback legado).
Correção de comparação apenas em WebSync para mídia OUTBOUND com autoria local:
legendas sem texto por String.trim e eco ausente/vazio/whitespace equivalentes;
igualdade textual, demais campos e snapshot explícito continuam estritos.
Nenhum body/transmittedBody normalizado ou reescrito. Quatro cenários novos
incluem snapshot legado vazio, IMAGE/VIDEO, whitespace Unicode, eco preservado,
texto divergente, deduplicação e negativas DEVICE/local textual.
Focados5/5 aprovados após correção (inclui criação inicial da fixture).
Suítes completas/checks Core e Provider em execução; evidências antes/depois
em20261013-attendant-whitespace-review/. Provider sem mudança de arquivo.

### 2026-10-13T14:47:59Z — PR37 legenda em branco — validada localmente

Core147/147 e Provider137/137, zero skips/falhas; lint/typecheck/build repetidos
e aprovados nos dois pacotes. OpenAPI idêntico/Prisma válido/zero novo drift em
wapphub_m1_test; nenhuma migration. Testes provam espaços simples/Unicode,
eco omitido/vazio/preservado, divergência textual, body/transmittedBody e IDs
intactos, sem duplicatas; legados com snapshot null/vazio e negativas de escopo.
Mudança funcional restrita à comparação em web-sync.ts; provider/contratos/
assinatura/enfileiramento/worker sem mudança desde d7f37f9. Documentos da entrega
e ponteiro STATUS atualizados sem declarar publicação. Evidências de reprodução,
correção e checks em20261013-attendant-whitespace-review/. Próxima ação: commit,
push na mesma PR37 draft e confirmação da CI do novo head; nenhum merge/deploy.
Resultados remotos finais serão preservados no relatório local da revisão.


### 2026-10-13T16:35:37.404260+00:00 — recuperação rápida autorizada — fases1/2

Usuário autoriza correção/publicação, limpeza escopada e reconexão/QR se necessários, preservando organizações/RBAC/outros tenants e sem envio automático. PR37/main41861c4 efetivamente publicada em API/Worker; Providerqrfix-06fafb6. Sessão afetada CONNECTED. Diagnóstico confirmou81 bootstrap historical=true/dead/attempts5,405 tentativas Core,32 failedBatches com HISTORY_EXECUTION_DISABLED;64 occurrences mascaradas como PERSISTENCE_FAILED. ProviderinitialHistory=true; Core/Worker/Providerexecution=false. Vault afetado848487bytes/13 referências bootstrap pendentes e CPU do Provider101% num snapshot; Core/DB sem saturação. Nenhum comando pendente. Correção mínima separa bootstrap scoped de on-demand; on-demand permanece desativado. Regressão reproduzida no banco isolado; teste novo prova Worker/live/bootstrap/dedup/tenant/lease. Evidências em20261013-whatsapp-recovery/. Próximos passos: checks, backup consistente mínimo, limpeza somente do canal ativo e deploy Core/restart Provider conservando identidade.


### 2026-10-13T16:39:55.035920+00:00 — recuperação fase2 validada

Regressão reproduzida (bootstrap não acked quando execution=false), corrigida pela correlação scoped em WebSync. Core148/148, lint/typecheck/build/Prisma aprovados. On-demand continua bloqueado; Worker prioriza send e journal prioriza live por comportamento já existente. Diagnóstico preserva HISTORY_EXECUTION_DISABLED em vez de mascará-lo. Mídia recebida com metadados válidos não tem referência no Vault; GET Provider404 antes do download/reprodução. Sem mudanças Provider nesta fase, sem ativar histórico irrestrito. Próximos: commit/imagem Core, backup quiescente, reset de filas/checkpoints somente do canal ativo e retomada autenticada.


### 2026-10-13T17:01:46.201845+00:00 — fase3/4 aplicada; latência restante localizada

Backup SQL/Vault quiescente e restore SQL isolado aprovados. Descartados81 dead-letter bootstrap/1615itens/14referências somente do canal ativo; nenhum registro de domínio apagado, inboxSQL/sends/receipts/identidade preservados. Core708443e publicado, Provider06fafb6 reiniciado sem QR; CONNECTED/PROCESSED, todas filas0, seis healthy,37outros containers intactos. Uma falha de auditoria na primeira tentativa SQL foi revertida pela transação; corrigido campo obrigatório de ator. Vault regravado com uid0 impediu primeiro startup; restaurado uid/gid1000/mode600 do backup antes da reconexão. Identidade/key material/QR preservados; lastAccountSyncTimestamp/lastPropHash atualizados normalmente pelo protocolo. Controles/sessões de outro tenant preservados.

Tráfego humano observado:3INBOUND/4OUTBOUND, sendsCOMPLETED/attempts1, cerca6–10s até confirmação Provider. Não homologar rapidez ainda. Profile5s confirma clones repetidos+GC; Provider138testes/checagens aprovados para snapshot único. CursorWorker tinha volta vazia; wrap corrigido e Core em validação. Sem ativar histórico, envio automático ou nova aprovação. Próximo: publicar somente imagens afetadas pela correção complementar e medir novamente. Mídia404por referência ausente e emoji picker registrados independentemente.


### 2026-10-13 — recuperação complementar validada; ajuste de assinatura iniciado

Core/Provider76bf571 publicados e CONNECTED, sem novo QR. Filas0; três envios humanos confirmados em2,695–4,673s, uma tentativa; nove entradasTEXT+umaVOICE observadas. Snapshot de status agora exclui da cópia diagnóstica material volumoso não utilizado; Vault original e get completo preservados. Provider138/138 e lint/typecheck/build; Core lint/typecheck/build aprovados. Worker ativo500ms substitui2000ms, mantendo fluxo/isolamento existentes. Inspector fechado; interrupção operacional do Provider ao terminar profiling (~16:56–17:07UTC) registrada e comunicada. Demais37containers preservados. Usuário pediu adicionalmente separador único na assinatura; implementação/testes em commit separado, sem reescrever snapshots já persistidos. Próximos: checks da assinatura, imagens finais, backup e publicação controlada.


### 2026-10-13 — assinatura sem linha extra validada

Única linha funcional alterada em outbound-signature.ts: `*nome*\n\nbody` → `*nome*\nbody`. Body/senderName/autoria/IDs e snapshots persistidos intactos, mídia sem texto sem assinatura. Unitários5/5, Core149/149 e Provider14/14 dos testes afetados aprovados; legendas IMAGE/VIDEO, limite8000, snapshots antigos com duas quebras, retry/eco/tenancy e renomeação validados. Correção de desempenho em commit separado da assinatura. Próximo: finalizar checks, commitar, imagem Core da assinatura e Providerda15c3b, backup e publicação nos três serviços autorizados.


### 2026-10-13 — recuperação/assinatura publicadas; homologação pendente

Core41fdf6a/Providerda15c3b publicados17:34:21UTC, rollout22,13s. SQL/Vault quiescentes antes, restauração SQL isolada375mensagens/12migrations; sem segunda limpeza. CONNECTED/PROCESSED, seishealthy/4HTTP200 e filasSQL/journal/sync/dead0, logs sem retries persistentes; identidade/chaves/QR e37demais containers preservados. Initial reset81dead/1615itens/14referências,0registros domínio apagados. Outro canal teve disconnect humano autenticado17:35UTC e rotação normal256recibos; executor não enviou comando. Inspector fechado. Core149/149/checks e Provider138/138 recuperação+14/14 assinatura aprovados. Fonte remota fix/whatsapp-bootstrap-live-recovery; main41861c4 preservada, revisão/integração adicionais pendentes.

Tempos reais observados antes do último rollout: três envios humanos2,695–4,673s e entradasTEXT/VOICE, uma tentativa; proxies e limites no relatório. Na versão final sem tráfego novo observado, não marcar HOMOLOGADO/latência eliminada. Pendências: ação humana para recebimento/envio/novo contato/renderização, mídia recebida404referência ausente/download/playback, emoji independente. Nenhum envio automático/novo QR/logout/migration/volume removido. Relatório completo com imagens IDs, SHAs, incidentes, backups e rollback `/home/uillan/homelab/deploy-records/wapphub-core/20261013-whatsapp-recovery/RELATORIO.md`. Próximo: homologação humana e revisão dos fixes; não executar operação WhatsApp real automaticamente.


### 2026-10-13,17:43UTC — tráfego humano observado na versão final

Três envios humanosCOMPLETED/attempts1 em1,110–2,192s até confirmaçãoProvider;3/3snapshots novos com body exato e separador único. IngressTEXT/IMAGE observado2,421/4,705s timestampWhatsApp→SQL; proxies não medem renderização/aparelho.48mensagens/12envios desde primeira retomada; filas0 por~558s uptime final. NovaIMAGE metadadosJPEG/153146bytes/SHA presentes, GETProvider404MEDIA_UNAVAILABLE268ms antes do download; mídia recebida continua pendente. Nenhuma ação real de envio pelo executor. Homologação visual/celular e novo contato permanecem pendentes; evidências traffic-final-version.json/media-final.json/verification.json.


### 2026-10-13T17:53:37.214370+00:00 — P1 mídia recebida, A0/A1 em análise

Usuário solicita diagnóstico/proposta A2 e aprovação antes de implementar. Sem merge/deploy/re-pareamento/limpeza/importação/envio real. Core fonte9435ed4 na branchfix/whatsapp-bootstrap-live-recovery; runtime41fdf6a, Providerda15c3b; Chatmain1b3219b/runtime dbab1ae. Working trees inicialmente limpas; seis serviços healthy e Compose/imagens conferidos, flagsmedia=true. Relatório de recuperação lido. Hipóteses a reproduzir: retain excluiquery no directPath silenciosamente, referência não chega ao Vault, clienteCore mascara errosProvider. Players atuais sob demanda porBlob, RangeCore já disponível. Diagnóstico em20261013-p1-received-media-a0-a2/. Só documentação de progresso alterada nesta fase; nenhum código funcional ou commit.


### 2026-10-13T18:13:36.203085+00:00 — P1 mídia, A0/A1 concluídos; A2 aguardando aprovação

16INBOUND4IMAGE/12VOICE com metadados/MIME/hash/size válidos;0registros/ref/cache correspondentes no Vault. GETProvider404 antes de download em record()/media.ts40, flags habilitadas. Reprodução isolada nos4tipos: plainpath200; querypath/URLonly normalizam mas são descartados por retain23 (8casos404), clienteCore mascara404como503. Envelopes originais recebidos indisponíveis; não presumir formato exato dessas16sem prova. Dois leaks de cancelamento do body simulados, sem rede. Core4/4/Provider14/14/Chat4/4 baselines aprovados.40containers IDs/imagens/StartedAt iguais, filas0, nenhuma mudança funcional/commit/PR/deploy/operaçãoWhatsApp real. Cache938654bytes/0part; ProviderCPU5,68%/90MiB num snapshot.

Proposta objetiva: docs/WHATSAPP_WEB_RECEIVED_MEDIA_P1_A2.md. B1 retenção de pathcomquery/URLcanonical autorizado, erros permitidos e abort/cleanup; B2 playersCore comRange sob demanda em commit separado; B3negativas echecks completosisolados. Sem schema/filas/sync/auth/envio/assinatura. Antigassemref não recuperáveis por metadata/SHA; mídia comrefválida seguecompatível. Evidências20261013-p1-received-media-a0-a2/RELATORIO_A0_A1_A2.md. Usuário pediu gateA2 antes de implementação, agora pendente; somente documentação local alterada, Chatlimpo. Próximo: receber aprovação da proposta; nenhum deploy/merge automático.


## 2026-10-13 — P1 implementação autorizada / etapa 0

A2 aprovada integralmente pelo usuário, incluindo PRs, CI, merges e deploy. Worktrees isoladas Core fix/received-media-p1 (base 9435ed4, preserva 41fdf6a) e Chat fix/received-media-players-p1 (base 1b3219b). Baseline e backups em /home/uillan/homelab/deploy-records/wapphub-core/20261013-p1-received-media-implementation. Sem envio, logout, pareamento, limpeza ou alterações de sync. Homologação real será humana.


## 2026-10-13 — P1 etapas 1–3 / validação

Retenção query/URL-only com origem fixa implementada; cancelamento/erros/cache e Range/CORS no Core, players sob demanda no Chat. Detectado também helperHTTP Baileys rc14 ignorando signal/redirect; patch versionado de instalação com testes do SDK real. Core153/153 e lint/type/build/Prisma12/drift/OpenAPI aprovados antes do teste adicional de abort HTTP. Provider/Chat completos em andamento. PR38 integra recuperação/assinatura, workflows84/80 verdes, merge ca2a05f. Backup/restauração SQL/Vault isolados aprovados (425mensagens,26tabelas,12migrations;1identidade6caches). Nenhum dado excluído ou migration/envio/logout/QR executado. Próximo gate: testes finais/revisão/PRs P1.


## 2026-10-13 — P1 etapas 4–8 concluídas tecnicamente / publicado

PUBLICADO — AGUARDANDO HOMOLOGAÇÃO REAL DE MÍDIA. CorePR39/763981a,ChatPR28/baaee36; dependênciaPR38/ca2a05f integrada. CI Core86/Provider82/Chat50 verdes e suites154/150/346. Imagens imutáveis/IDs e relatório em WHATSAPP_WEB_RECEIVED_MEDIA_P1.md e deploy-records/20261013-p1-received-media-implementation. Deploy19:32:51–19:33:19UTC; seishealthy, saúde/ready200, CORScredentials/Range204, assets iguais, conexãoCONNECTED/QR2/identidade preservados, filas/dead/outbound0,38containers alheios intactos. Backup/restauraçãoSQL/Vault/configs isolados aprovados, rollback de imagens preparado/não necessário. Sem migrations, exclusão, restauraçãoSignal, envio real, QR/logout/história. Smokes da imagem8novasrefs sintéticas+SDKreal/AES/HMAC/cliente eCoreautenticado emDBtest passaram. GETcacheprod200/SHAválido; antigassemref404esperado. Próximo gate exclusivo do usuário: receber mídia nova e homologar players no notebook; nenhuma homologação visual presumida.
