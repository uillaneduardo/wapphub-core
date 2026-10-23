# WappHub — contrato de execução e consolidação arquitetural (GitHub ou Codex)

**Vigência:** 2026-10-11; **revisão de executor:** 2026-10-23. **Natureza:** norma de trabalho entre repositórios; não é autorização de alteração funcional ou deploy.

## 1. Papéis e fonte da verdade

- **Usuário/Product Owner:** define objetivos, prioridades, aprova a proposta arquitetural consolidada antes de iniciar mudanças funcionais e realiza a **homologação final no navegador** após deploy autorizado. Não solicitar aprovação repetitiva de tarefas técnicas já incluídas no escopo aprovado.
- **Codex no homelab — executor opcional:** quando disponível, pode inspecionar **estado real de execução** (Git, Docker, Compose, banco, filas, volumes, métricas, relatórios em `deploy-records`), propor/refatorar código, executar testes, abrir PRs, integrar e executar deploy quando autorizado. Pode consultar a fonte do SDK e o código instalado em `node_modules`. Não supor que o GitHub represente produção.
- **ChatGPT nesta conversa — executor GitHub e revisão:** pode inspecionar, planejar e implementar código nos repositórios GitHub, criar branches e PRs e verificar resultados reais de CI. Na ausência de acesso ao homelab, fornece comandos para sync/build/deploy ao usuário e não afirma testes locais ou publicação sem evidência. GitHub é referência de código; relatório e medições locais comprovam execução em produção.
- **Core (`wapphub-core`) é autoridade** dos contratos, domínio, autorização, persistência, estados canônicos e do **acompanhamento** em `docs/WHATSAPP_WEB_CONSOLIDATION_PROGRESS.md`. Provider Web está em `services/wapphub-provider-web` no mesmo repositório; Chat e Platform têm repositórios próprios. Platform fica fora do escopo atual salvo dependência justificada.

## 2. Escopo de produto que orienta decisões

WappHub é uma plataforma SaaS multi-tenant de atendimento. Demo Provider demonstra atendimento sem rede externa; WhatsApp Web Provider usa Baileys como dispositivo adicional vinculado da conta da organização; Meta Cloud API é um adaptador futuro e distinto.

- **Core:** Organization/Channel/Contact/Conversation/Message, tags, atribuições, RBAC, auditoria, realtime, histórico paginado, domínio e persistência canônicos. As permissões de leitura de histórico de atendentes (FULL/LIMITED/NONE) continuam obrigatórias.
- **Provider:** sessão/QR, credenciais criptografadas, normalização de eventos, transporte de mídia, eventos históricos e sincronização contínua; nunca se torna a fonte de verdade das conversas do WappHub.
- **Chat:** UI/UX, Inbox, estado da conexão e operações autorizadas via Core; sem acesso direto à sessão ou SDK.
- **Sincronização contínua:** obrigatória quando a conexão estiver ativa, em segundo plano, independente de navegador e sem botão que a desabilite como se fosse uma opção estética.
- **Primeiro pareamento:** capturar metadados/histórico **efetivamente entregues** pelo protocolo, com limites de lote/memória e processamento incremental; não limitar artificialmente a conta inteira a um piloto de 20 mensagens.
- **Retomada e histórico adicional:** somente com mecanismo verificado, checkpoints, idempotência e orçamento; não prometer reconstruir histórico indisponível, nem forçar QR, logout ou novo pareamento.
- **Envio e recebimento são requisitos essenciais, não opcionais:** permitir receber mensagens da conta vinculada, responder pelo Chat e **iniciar nova conversa** escolhendo um contato existente ou informando um número que ainda não conste no cadastro do WappHub; após resolução/validação do destinatário, criar contato/conversa tenant-scoped sem duplicar identidades nem inventar dados. Suportar texto, imagem, áudio e vídeo conforme capacidade real do Provider. Chamadas ficam fora do escopo.
- **Destinatário/abertura:** confirmar canal e conexão da Organization, permissão de iniciar conversa e enviar, normalizar telefone com código do país (sem supor DDI brasileiro), pesquisar contato/identidades existentes e validar formato/existência no WhatsApp quando a API da versão instalada oferecer consulta segura. Número desconhecido **no cadastro** não significa que existe no WhatsApp; comunicar a diferença. Não criar conversas fantasma nem enviar automaticamente na simples digitação. A ação explícita de enviar pode criar o vínculo quando válido. Idempotência por `clientMessageId` e identidade de canal, sem mesclar por nome.
- **Outbound fim a fim:** `Chat → Core (RBAC/Membership, canal, quotas, dados e transação) → Outbox/Worker → Provider.sendText/sendMedia → Baileys → recibos/status → Core → realtime/Chat`. Registrar autoria do atendente, `NOT_SENT/UNKNOWN/SENT/DELIVERED/READ` quando observáveis, timeout/retry seguro, sem retransmitir mensagem de resultado incerto. Nunca tratar sucesso HTTP inicial como entrega ao destinatário.
- **Conversa remota arquivada:** registrar esse metadado quando disponível, sem confundir com o arquivamento operacional do Core. Tags, notas e atribuições continuam internas ao WappHub.
- **Multimídia:** investigar fluxo Baileys/WhatsApp de upload/download e expiração de mídia; preferir streaming autenticado e cache controlado, sem prometer armazenamento remoto permanente nem expor chaves de mídia ao navegador. Chamadas ficam fora do escopo.
- **Providers novos:** usar capability contract/registry/adapters quando houver necessidade concreta; evitar `if(provider===...)` espalhado pelo domínio. Não introduzir abstrações ou microsserviços hipotéticos.

## 3. Princípios de engenharia

1. **Investigar e medir antes de alterar.** Ler README/AGENTS, docs do repo, código real, versão/lock do Baileys, histórico de PRs e relatórios locais; diferenciar fatos, hipótese e risco.
2. **Reutilizar o existente.** Mapear fluxos `Baileys → Adapter/Sessions → journal/sync.batch → Worker/Core → MariaDB/realtime → Chat` e operações inversas antes de criar novas camadas. Apontar repetições por arquivo/função/chamada, não por impressão.
3. **Uma responsabilidade por camada.** Preservar separação Core/Provider/Chat; unificar somente lógica genuinamente duplicada. Manter interfaces pequenas, sem generalização especulativa, sem nova fila/banco/microserviço sem ADR.
4. **Segurança inegociável.** Multi-tenancy, Membership ativa, RBAC, isolamento de sessão por org/conexão, CSRF/CORS, idempotência, commit-before-ack, outbox/inbox, auditoria, criptografia e proteção de dados. Nenhuma permissão concedida por botão do frontend.
5. **Não quebrar o CP4 contínuo nem Demo.** Eventos live têm prioridade sobre backfill; preservar autoria real, identidades PN/LID, arquivamento/tags/atribuições e rolagem na Inbox. Backfill não gera falso não-lido nem notificações de mensagem nova.
6. **Não expor dados sensíveis.** Sem credenciais, QR, chaves Signal, mensagens reais, mídia, IDs pessoais ou dumps de banco em commits, CI, relatórios e logs.
7. **Fontes e versões:** usar documentação/código da versão exata do Baileys instalada e sua API realmente disponível; não presumir suporte a recuperação integral de contatos/conversas antigas.
8. **Documentação não é teste.** Estado funcional exige testes automatizados + verificação no ambiente; homologação do navegador pertence ao usuário.

## 4. Fluxo obrigatório — duas autorizações, sem microaprovações

### Fase A — Diagnóstico e proposta, sem alterar funcionalidade

**A0. Retomada:** localizar repos e Compose reais sem assumir paths; ler os AGENTS de cada repositório e os documentos listados; executar `git status`, registrar branch/SHAs e mudanças locais; confirmar estado real de serviços e recursos, flags históricas, relatórios de deploy. Nunca descartar alterações não comitadas. Registrar status inicial no documento de progresso.

**A1. Inventário de código e Baileys:** listar funções, eventos, responsáveis, persistência e cobertura de testes para QR, reconexão, histórico inicial, chats/contatos, `messages.upsert`, `messaging-history.set`, `fetchMessageHistory`, `onWhatsApp`/consulta equivalente, `sendMessage`, ACK/status, upload/download e streaming de imagem/áudio/vídeo, autorização de envio, início de conversa com número novo e contato existente, arquivamento e envio. Identificar handlers ignorados, filtros, limiares, fluxos duplicados e dead code com evidência de arquivo/linha. Distinguir bootstrap no primeiro vínculo de recuperação após vínculo existente. Inventariar riscos de bibliotecas não oficiais.

**A2. Plano consolidado:** escrever proposta objetiva, matriz `existente → lacuna → alteração mínima → teste → risco/rollback`, diagrama de dados e capability matrix Demo/WhatsApp Web/Meta futuro, limites por lote vs. limite total, regras de negócio, estratégia de mídia e fases internas de implementação. Registrar alternativas rejeitadas e dependências. **Parar neste gate e pedir uma única aprovação da proposta ao usuário.** Não alterar lógica de produto, reconfigurar socket, iniciar solicitações reais, parear ou publicar código nessa fase.

### Fase B — Execução técnica após aprovação da proposta

**B1. Ajustes mínimos do Provider:** sessão QR, captura inicial quando o protocolo entrega, normalização, reconexão e fila durável já existente. Provar que novo QR, logout ou replay não são acionados automaticamente em conta vinculada.

**B2. Consolidação Core/Worker:** ingestão live e histórica com modelo canônico e dedup, cursores, paginar conversas e mensagens, identidade, mídia/arquivamento/capabilities sem regras duplicadas. Manter rota/canal tenant-scoped e eventos realtime.

**B3. Atendimento bidirecional + Chat/UX:** comprovar envio/recebimento real por canal e responder conversa; permitir **abrir conversa a partir de contato existente ou número não cadastrado** e enviar texto, imagem, áudio e vídeo através do Core/Provider, conforme contratos e políticas definidos em A2. Verificar capacidades reais do Baileys e resolver números/PN/LID de modo seguro; usar outbox/retry idempotente, estados e autoria correta. Na UI: seletor pesquisável, campo número com DDI, validação e mensagens de erro claras, sem gerar registros inválidos; Inbox, paginação/scroll, estados de histórico e diagnóstico sem ruído. Não permitir controles que aparentem desligar a sincronização live normal.

**B4. Integração e hardening:** testes unitários e integração entre camadas, regressão Demo, schema/OpenAPI, lint/typecheck/build, testes de autorização negativos, consumo CPU/RAM, backpressure e retomada. Testar mídia e upload em dados sintéticos, sem chamadas reais não autorizadas. Rodar CI dos PRs.

**B5. Preparação e publicação:** produzir migrações aditivas, backup e restauração isolada, plano de rollback, imagens imutáveis e smokes. **Deploy só se estiver explicitamente autorizado para esta implementação**, preservando autenticação, volumes e outros serviços; nenhum re-pareamento, logout, upload/envio real ou recuperação histórica invasiva automaticamente. Distinguir publicação de execução histórica real, que precisa de autorização aplicável do usuário/conexão.

**B6. Entrega:** registrar SHAs, PRs, testes, métricas, estado de serviços, bloqueios e roteiro curto de homologação; marcar `AGUARDANDO_HOMOLOGACAO`. **Não homologar pelo usuário nem marcar milestone como concluído.** Usuário testa no navegador; registrar feedback e correções após homologação.

As fases B1–B5 são **gates internos**, não convites para interromper a cada etapa. Se houver risco destrutivo, migração incompatível, perda de sessão, acesso ausente ou operação real fora da autorização, bloquear apenas a ação perigosa, preservar o restante seguro e apresentar uma pergunta objetiva.

## 5. Protocolo de progresso e retomada

Fonte canônica: `docs/WHATSAPP_WEB_CONSOLIDATION_PROGRESS.md` no **Core**.

Atualizar **ao iniciar e concluir cada fase/gate**, e quando houver bloqueio ou decisão relevante. Cada atualização inclui:

- fase e estado: `PENDENTE`, `EM_ANDAMENTO`, `BLOQUEADO`, `VALIDADO_TECNICAMENTE`, `PUBLICADO`, `AGUARDANDO_HOMOLOGACAO`, `HOMOLOGADO`;
- UTC/data, repos/branches/SHAs, ambiente (local, isolado, produção);
- alterações concretas, testes/comandos/resultados, URLs de PRs, logs/relatórios sem segredos, riscos abertos e próxima ação segura;
- decisões aprovadas e restrições de autorização, evidência que sustenta cada conclusão.

Se houver pausa de contexto, **ler o progresso antes de retomar**, conferir Git e serviços e continuar do próximo gate pendente. Nunca sobrescrever evidência histórica ou marcar sucesso sem reproduzir/verificar. Preferir commits pequenos no branch do trabalho, atualizando o progresso na mesma PR. `docs/STATUS.md` só registra fatos publicados ou homologados, conforme suas regras; não substituir STATUS por progresso provisório.

## 6. Restrições e critérios de aceite

- Ao concluir A2, nenhuma função alterada, produção intacta; entregar proposta revisável ao usuário.
- Após aprovação, validar o contrato do provider e seus testes de segurança/tenancy em cada gate; não declarar todas as conversas recuperadas sem evidência de mensagens realmente disponibilizadas.
- Permitir importação progressiva e paginada com limites por lote e segurança de memória; se dados históricos remotos estiverem indisponíveis, registrar limite e não fingir sucesso.
- Testes obrigatórios de envio/recebimento e abertura de conversas: contato existente, número válido não cadastrado, número inválido, destinatário inexistente, falta de permissão, organização/canal diferente, retry de envio incerto, concorrência/idempotência, vínculo PN/LID, status e autoria, mídia grande/indisponível e compatibilidade Demo. Nenhuma mensagem real será enviada por automação de testes sem autorização explícita.
- Não baixar arquivos de mídia de todas as conversas automaticamente; não transmitir material criptográfico ao navegador.
- O homelab **não instala nem executa navegadores gráficos/Playwright** para homologação visual; são permitidos testes HTTP, API, integração e componentes sem navegador. O usuário homologa visualmente em seu notebook após deploy.
- Nenhuma política acima derroga instruções de segurança/AGENTS do repositório; em caso de conflito, aplicar a regra mais restritiva e registrar.


## 7. Modo de implementação direta por ChatGPT (revisão 2026-10-23)

- Codex não é obrigatório. O pedido explícito do usuário para implementar autoriza o escopo já definido sem nova rodada de aprovação redundante. Publicação em produção e operação real de WhatsApp permanecem sujeitas às autorizações específicas.
- Modificar branches e abrir PRs por repositório, verificar CI e testes negativos, registrar blockers honestamente; nunca mascarar funcionalidade ausente com documentação.
- Não habilitar capability até Core/Provider/Chat terem contratos e testes ponta a ponta. Sem acesso ao runtime não se declara produção validada.
- Após mudanças Core, coordenar build/restart de API/Worker/Provider; mudanças só de Chat não exigem reinício do Provider. Respeitar Compose, imagens, env, volumes e sessão do host; nada de `down -v`.
- Entregar código/comandos de git fetch/pull, imagem rastreável por SHA, migração aplicável, up e health/logs; o usuário executa e homologa em navegador.
