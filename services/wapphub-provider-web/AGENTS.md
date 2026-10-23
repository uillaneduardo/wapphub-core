# Agentes — WappHub WhatsApp Web Provider (Baileys)

Este diretório implementa um **adapter de canal**, não um segundo backend de negócio.
Este arquivo complementa `../../AGENTS.md` e os documentos:
- `../../docs/WHATSAPP_WEB_CONSOLIDATION_EXECUTION.md` — contrato obrigatório de fases e autorizações;
- `../../docs/WHATSAPP_WEB_CONSOLIDATION_PROGRESS.md` — progresso canônico, atualizar após cada gate;
- `../../docs/ARCHITECTURE.md`, `../../docs/PROVIDER_CONTRACT.md`, `../../docs/SECURITY_PRIVACY.md`;
- `../../docs/WHATSAPP_WEB_NATIVE_BOOTSTRAP.md` e docs CP4–CP4.7, sujeitos a verificação do código/versão no runtime.

## Responsabilidade

- Integração de uma conta da Organization como **dispositivo adicional**, vinculada via QR e controlada pelo Owner autorizado; credenciais/Signal keys persistidas criptografadas, sem vazamento no Chat.
- Fluxo de entrada: `Baileys → normalização → journal durável / sync.batch → Core Worker → domínio → realtime`.
- Fluxo de saída a implementar/auditar: `Core/outbox → comando assinado, tenant-scoped e idempotente → Provider → Baileys.sendMessage → confirmação/recibos → Core`.
- **Operação bidirecional**: texto; imagens, áudio, vídeo e documentos conforme capabilities. Permitir mensagens destinadas a contatos existentes **ou números ainda não cadastrados no WappHub**, nunca pressupondo que o número seja válido no WhatsApp. Validar entrada/identidades e verificar número no serviço por operação suportada na versão instalada, quando aplicável; sem mesclar contatos por nome nem inventar número a partir de LID.
- Recebimento contínuo é essencial enquanto a sessão está conectada. O Worker deve funcionar sem navegador e sem botão de desligar o fluxo live. Metadados históricos no primeiro pareamento e recuperações adicionais somente se fornecidos pelo WhatsApp, por filas limitadas/retomáveis.
- O Provider não decide RBAC do usuário, tags, visibilidade de histórico por atendente, atribuição, arquivamento interno nem regras de negócio. O Core valida os comandos e controla persistência/autoria; Provider valida autenticação serviço-a-serviço/escopo e restrições técnicas.
- Eventos `chats.upsert/update`, `contacts.upsert/update`, `messaging-history.set`, `messages.upsert/update`, recibos e status devem ser avaliados de acordo com a **versão Baileys instalada**, sem suposições de API; documentar lacunas reais e comportamentos `notify`/`append`.
- Arquivamento do WhatsApp quando recebido é metadado remoto; não alterar o arquivamento operacional do WappHub sem comando específico.
- Mídia pode utilizar infraestrutura do WhatsApp quando disponível, mas precisa de acesso autenticado, descriptografia server-side, streaming/backpressure e eventual cache temporário criptografado; arquivos podem expirar. Não enviar chaves, mediaKey, tokens, QR, URLs de download sensíveis ou conteúdo dos clientes ao browser ou aos logs.

## Fluxo antes de qualquer alteração funcional

1. Ler `../../docs/WHATSAPP_WEB_CONSOLIDATION_PROGRESS.md` e comparar main, branch, tag/imagens Docker e Compose realmente publicados. Nunca supor ambiente de produção a partir do GitHub.
2. Inventariar chamadas/handlers do SDK e medir fluxos reais e limites. Auditar também `src/baileys.ts`, `src/sessions.ts`, `src/history-operation.ts`, `src/history.ts`, `src/events.ts`, `src/vault.ts`, `src/sync-normalization.ts` e integração Core/Worker, considerando a PR #23. Identificar fluxos mortos ou duplicações **com provas**, não por intuição.
3. Atualizar a fase A1/A2 do documento de progresso e gerar proposta enxuta `existente → alteração mínima → teste → risco`. **Considerar o pedido explícito do usuário de implementação como aprovação do escopo; evitar nova aprovação redundante.**
4. Após a aprovação: implementar em passos internos com testes de contrato/regressão (sem nova camada ou fila desnecessária); documentar gatilhos de execução real, flags e rollback; atualizar progresso a cada gate; abrir PRs e rodar lint/typecheck/build/CI.
5. Deploy só conforme autorização existente; preservar sessão, volumes e chaves; backup/restauração isolada e rollback. Não provocar novo QR, logout, re-pareamento, envio real, upload real nem solicitação histórica real fora da autorização explícita.
6. Deixar a homologação no navegador com o usuário; não marcar `HOMOLOGADO` com base em testes automatizados.

## Testes mínimos específicos

QR inicial, reconexão preservada, bootstrap parcial/vazio, históricos acima do limite, importação progressiva, idempotência entre live e histórico, PN/LID, contato conhecido/desconhecido, validação de número, `sendMessage` de texto e mídia com mocks, erro de destino e falha/timeout/resultado incerto, recebimento live concorrente, ordem, perfis sem permissão, isolamento multi-tenant, assinatura/HMAC de comandos, cancelamento e restart. Testes não enviam mensagens reais.

**Sem funcionalidades extras:** grupos, status, chamadas, marketing ou IA não são escopo desta consolidação, salvo mudança de produto expressa pelo usuário.


## Executor alternativo ChatGPT/GitHub (2026-10-23)

Codex é opcional. ChatGPT pode implementar no repositório via branch/PR, com contratos, testes e CI. Sem acesso ao Docker do homelab, entregar comandos de build e verificação operacional e não declarar serviço publicado. Core modificado requer planejamento e verificação conjunta de API/Worker/Provider. Preservar volume de sessão, secrets, flags e QR; não parear ou enviar mídia real automaticamente.
