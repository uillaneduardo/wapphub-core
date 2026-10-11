# CP4.6 — importação histórica controlada

Esta implementação fecha os gaps descritos em WHATSAPP_WEB_HISTORY_PREPARATION.md. CP4 contínuo já foi homologado pelo usuário; esse aceite não inclui histórico. CP4.6 não executa importação na conta real, novo pareamento, envio pelo Chat ou download de mídias.

## Mecanismo e limite da evidência

Baileys instalado/travado: 7.0.0-rc14. `fetchMessageHistory(count,key,timestampMs)` envia HISTORY_SYNC_ON_DEMAND ao aparelho autenticado, usando uma mensagem conhecida da conversa; retorna o ID da solicitação, não o histórico. A implementação foi conferida no SDK instalado e nos fontes primários da tag: [messages-recv.ts](https://github.com/WhiskeySockets/Baileys/blob/v7.0.0-rc14/src/Socket/messages-recv.ts), [history.ts](https://github.com/WhiskeySockets/Baileys/blob/v7.0.0-rc14/src/Utils/history.ts), [chats.ts](https://github.com/WhiskeySockets/Baileys/blob/v7.0.0-rc14/src/Socket/chats.ts).

Adapter, decodificação e pipeline têm evidência sintética. A recuperação adicional na conta atual permanece NÃO COMPROVADA: nenhuma requisição real foi autorizada/executada. A auditoria anterior encontrou zero lotes históricos locais recuperáveis e nenhuma notificação de histórico retida. Não é possível reconstruir notificações antigas descartadas. As 14 falhas legadas permanecem sem causa comprovada.

ON_DEMAND depende de âncoras em conversas conhecidas. Não existe nesta implementação uma API comprovada para enumerar todas as conversas/contatos antigos desconhecidos. Metadados recebidos criam conversas independentes de mensagens; isso não garante que o WhatsApp os forneça para todas as conversas. `resyncAppState` usa snapshots/loops sem limites equivalentes e não foi acionado ou exposto como importador. Reconexão/full-history não garante bootstrap adicional; novo pareamento exige decisão separada e não é automático.

## Contratos e persistência

Contrato canônico `sync.batch` intacto, reutilizado por Core e adapter. Particularidades SDK ficam no Provider. Operação/cursor/recibos únicos e referência mínima do arquivo ficam no vault criptografado já existente; eventos usam o journal pull/ack/lease/retry/dead-letter existente. Nenhuma segunda fila/base de mensagens ou contatos.

Migration aditiva 202610110002_controlled_history: JSON nullable `ProviderConnection.historyOperation` e `ProviderCommand.payload`. A primeira conserva a operação separada do parser de diagnóstico cumulativo, os contadores reais do Core e manifest limitado de IDs internos NOVOS. A segunda usa o outbox já existente para preparar/controlar a operação sem chamadas de rede na transação HTTP. Operação contém apenas estado/intervalo/limites/identidade do administrador e IDs internos; payload de comando contém somente controle e até 16 âncoras privadas, nunca conteúdo de mensagem. Não concede permissões novas.

Uma operação por conexão; manifest de no máximo 500 contatos/500 conversas/1.000 mensagens, substituído somente quando operação terminal e origem sem lotes anteriores. Não permite exclusão de dados ou reprocessamento manual. Comandos têm recibos idempotentes; colisão de UUID/parâmetros é recusada. Publicação segura pode manter as colunas no rollback, sem migration reversa.

## API administrativa

- GET `/api/v1/providers/whatsapp-web/connections/{id}/history`: estado sanitizado, execução habilitada/bloqueada, contadores de admissão e persistência separados, correlação. No-store; sem âncoras, manifest, sessão, payloads, conteúdo ou stacks.
- POST `.../history/prepare`: commandId e expectedVersion, limite de mensagens 1–1.000 (padrão piloto 20); congela 30 dias e seleciona até 16 âncoras scoping organização/conexão via consulta em lote. Preparar não solicita histórico.
- POST `.../history/commands`: start/pause/resume/cancel, operationId/commandId/expectedVersion.

Exige conjuntamente `providers.manage`, `providers.diagnostics.read`, `conversations.supervise`, `messages.read`, membership e sessão ativas, CSRF para mutações. Worker revalida autorização ao executar outbox e enquanto produtor ativo; perda de permissão/sessão/flag pausa o produtor. Não amplia acesso de agentes; visibilidade das conversas usa política existente de Não atribuídas/Todas e fronteiras de supervisão/atribuição.

Execução real exige flag `PROVIDER_HISTORY_EXECUTION_ENABLED=true` no Core E no Provider, mais `PROVIDER_HISTORY_APPROVED_SCOPE=organizationId:connectionId` exato na origem. Ambos os Compose publicados mantêm execução false. SDK automático/full-history permanece false; start/resume com flag false resulta 403 e zero requisições. Alterar flags exige autorização específica da operação real, não decorre do deploy deste código.

## Limites e retomada

Até 500 contatos, 500 conversas e 1.000 mensagens em 30 dias congelados. Até 16 solicitações de no máximo 100 mensagens cada; avança a âncora quando resposta oferece mensagem anterior, para no intervalo, quota, ausência de avanço ou timeout. Não garante quantidade/completude. Contatos/chats são admitidos independentemente das mensagens; PN/LID são associados somente por aliases do protocolo, nunca por nome/telefone inventado.

Arquivo de protocolo comprimido até 1 MiB; descomprimido até 8 MiB, seleção protobuf antes da materialização limitada a 500 conversas/500 nomes/500 mapeamentos/1.000 mensagens. Filtro temporal precede quota de mensagens. Um download por vez, 15s, até 16 referências e 32 MiB descomprimidos por operação. Arquivo de protocolo não é mídia de mensagens; sua obtenção real também permanece bloqueada. Referência mínima criptografada, sem persistir objetos completos SDK. Conteúdo de mídias permanece só metadados/referências normalizadas, sem binários no MariaDB.

Spool sintético normalizado até 2 MiB; protocolo retém referência limitada e cursor para redecodificação segura. Staging 1.500 itens/1,5 MiB para histórico, reserva até 2.000/2 MiB para live; lotes normalizados até 20 itens/48.000 bytes na promoção e envelope 64 KiB. Quando cheio, aguarda espaço, sem avançar cursor ou gastar quota dos itens não admitidos. Recibos por item evitam gastar quota em replay. Prioridade live nos pulls; transações curtas/savepoint por item, retry existente até 5 e dead-letter preservado.

Pausa/cancelamento afetam produtor; lotes duráveis já admitidos podem terminar persistência. Cancelar não apaga domínio/credenciais. Reinício pausa operação ativa e preserva cursor; não repete requisição de resultado incerto. Timeout de resposta 60s, autorização temporária 15min, retomada explícita. Core mantém manifest atomicamente com persistência/inbox/realtime; rollback de banco não aumenta contadores. Estado não informa conclusão enquanto itens estiverem na fila ou falhas/rejeições conhecidas estiverem pendentes.

Timestamps/autoria originais preservados; DEVICE não vira atendente; corpo e prefixos intactos. Histórico não sobrescreve atribuição/tags/notas/status administrativo/nome manual e usa realtime agregado, sem alertar por mensagem antiga. Conversa só com metadados é visível no endpoint Inbox e publicada por conversation.updated sem message.created.

## Controles e validação

Configurações → Provedores → Histórico controlado, visível somente ao conjunto de permissões acima. Preparar, consultar, pausar/cancelar produtor; iniciar/retomar desabilitados com execução bloqueada. Execução habilitada futuramente exige confirmação explícita no painel. UI consulta só Core, reúne atualizações de realtime sem polling frequente, aborta respostas na troca de tenant e adapta layout sem porcentagens fictícias.

Testes sintéticos incluem SDK real/mapa de eventos, notificação self-only, protobuf limitado, recuperação de vault/cursor e requisição incerta, backpressure com 2.000 itens, live prioritário, deduplicação sem consumir orçamento, janela congelada, retenção de journal no cancelamento, API/RBAC/tenant/CSRF/limites/sanitização, flags bloqueadas, banco real isolado, falha SQL/recuperação, manifest, conversa metadata-only/realtime WebSocket/Inbox e autoria DEVICE. Regressões existentes cobrem Demo, atribuições/tags/notas/nomes/autoria e fronteiras de visibilidade. Chat testado em jsdom; homologação visual manual pelo usuário, sem navegador gráfico no homelab.

## Execução futura e rollback

Antes de pedir autorização real: revalidar sessão/readiness, espaço/RAM, backlog/dead-letter zero, backup restaurável, tenant/conexão e conta existente. Propor piloto de 20 mensagens em conversa conhecida, 30 dias e limites explícitos; informar que nenhuma enumeração completa é garantida. Sem dados/timeout, parar e documentar alternativas. Nunca QR automático nem aumento de escopo sem autorização.

Rollback deste release: flags false; retornar às imagens anteriores preservando banco, colunas aditivas e volume/chaves. Não restaurar snapshot Signal sobre sessão viva. Se recuperação da origem falhar, parar somente Provider e guardar diagnóstico; limite ligado existente de até 3 transport starts/processo e 5 tentativas persistidas. Durante operação real futura, pausar/cancelar produtor e escoar lotes válidos antes de trocar runtime. Nunca DELETE por historical=true ou restauração do banco inteiro para desfazer importação.
