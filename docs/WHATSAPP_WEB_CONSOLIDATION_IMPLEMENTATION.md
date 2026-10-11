# Consolidação B1–B4 — implementação e aceite técnico

A proposta do PR25 e [sua revisão obrigatória](https://github.com/uillaneduardo/wapphub-core/pull/25#pullrequestreview-5484867318) foram aplicadas em branches de revisão. Este documento descreve código integrado e testes sintéticos; **não descreve deploy ou homologação produtiva**. O registro canônico é [PROGRESS](WHATSAPP_WEB_CONSOLIDATION_PROGRESS.md). Decisões de escopo: [ADR](ADR_WHATSAPP_WEB_CONSOLIDATION.md).

## Arquitetura final e reutilização

`Chat → sessão/CSRF/RBAC Core → Message + ProviderCommand na mesma transação → Worker → HMAC Provider → Vault/receipt → Baileys → journal → Inbox/SQL → realtime Chat`.

Recebimento clássico e `sync.batch` compartilham a persistência canônica WebSync. O envelope original e seu hash permanecem no Inbox; não há segundo serviço, fila, banco, outbox ou framework. Identidade comprovada de canal/PN/LID reutiliza contatos sem mesclar nomes. Metadados esparsos atualizam somente os campos presentes; arquivamento remoto permanece separado de atribuições, tags, notas e arquivamento interno. Echo de envio conhecido preserva autoria SQL do atendente e data da intenção; autoria externa não é convertida em autoria interna.

Provider usa Baileys **7.0.0-rc14**, conferido no lock, pacote instalado e runtime publicado. `sendMessage` aceita o ID reservado pelo Core; `onWhatsApp` resolve explicitamente um número E.164; `fetchMessageHistory` exige mensagem e timestamp de protocolo conhecidos. Nenhuma dessas verificações de implementação fez chamadas reais nesta execução.

## B1 — P0 e sessão

- A decisão de capturar bootstrap é consultada no evento, sem congelar o estado inicial do socket; append recente volta ao live após RECENT100.
- Contagem histórica `attempts` é preservada. `recoveryFailures` opcional delimita o episódio, com cinco falhas e limite adicional de três starts/processo no modo vinculado; conexão autenticada estável por 30s encerra o episódio. Vault legado conectado com attempts=5 recupera sem edição manual ou novo QR; estado terminal/revogado/esgotado permanece bloqueado.
- Fixtures temporais compartilham epoch; contrato de 30 dias não foi relaxado. Falha de reader-policy em pausa não gera reconciles sem progresso a cada tick.

## B2 — persistência, orçamento e continuidade

Bootstrap já entregue é paginado em **100 registros de wire / até 300 SyncItems**, checkpoint e staging atômicos; cache de arquivo comprimido criptografado permite retomada sem repetir download a cada página. Janela temporal persistida, intervalo mínimo de 30s, backoff 30–300s, cinco falhas, ciclo máximo de 16 referências / 32 MiB decodificados; arquivo comprimido até 4 MiB, descomprimido até 16 MiB. Limites de staging/spool/envelopes são preservados. Pressão de RSS a 384 MiB pausa trabalho de fundo; reserva de live permanece prioritária. Referências maiores/inconclusivas produzem estado parcial, nunca promessa de histórico completo.

Os antigos 500 contatos / 500 conversas / 1.000 mensagens continuam como limites **da operação ON_DEMAND**, não como teto permanente do bootstrap da conta. Captura nativa usa correlação determinística org/conexão, separada do grant histórico; não consome nem amplia o piloto adicional autorizado de **20 mensagens, 16 requisições, janela 30 dias**, intervalos/cooldown/checkpoints/leases existentes. Deploy/restart não invoca `fetchMessageHistory`. Requests incertos não são reiniciados automaticamente.

Âncoras adicionais excluem PENDING, UNKNOWN e intenção interna sem timestamp observado no protocolo; preferem o mais antigo elegível na janela. Grant persistente, autorização por conexão e browser independente reutilizam CP4.7. As 14 falhas legadas continuam históricas, sem causa reconstruível; novos recibos/mensagens não são somados a contadores de outra natureza.

## B3 — conversa, envio e mídia

- Abrir conversa exige ação explícita, conexão pronta, permissões de contato/conversa e escopo autenticado. Contato com identidade comprovada é reutilizado; número novo exige DDI e `contacts.write`, consulta de existência e revalidação da sessão/organização após a resposta. NOT_FOUND e UNKNOWN não criam registros. Abrir/digitar não envia mensagem.
- Core reserva ID do Provider e persiste intenção PENDING com ator real, clientMessageId e comando antes da rede. Worker revalida sessão, Membership, permissões, visibilidade e capabilities. Recibo/echo confirma status monotônico; ID retornado pelo SDK não comprova entrega.
- Vault persiste UNKNOWN **antes** do SDK. Mesmo comando/digest após restart retorna recibo, sem retransmissão incerta. Revalidação HTTP usa o mesmo intent; backoff limitado de cinco tentativas. Ausência de confirmação por 60s indica UNKNOWN. Retry explícito reaproveita intenção somente quando a autorização falhou comprovadamente antes de qualquer RPC; UNKNOWN não oferece retry cego.
- Serial da sessão é liberada durante rede. Worker consome journal enquanto aguarda envio; nenhuma solicitação de envio bloqueia o processamento live no teste integrado.
- Imagem JPEG/PNG/WebP até 8 MiB; áudio/voz até 16 MiB; vídeo MP4 H.264/AAC até 25 MiB; duração até 600s. FFprobe inspeciona codec/container com timeout e limites; voz WebM/formatos compatíveis converte para Ogg/Opus via FFmpeg com uma thread. Documentos permanecem metadata-only, grupos/chamadas/Status/campanhas fora de escopo.
- Media SQL guarda apenas metadados/vínculo org/canal/conversa/ator/mensagem. Referência privada com mediaKey/directPath fica no Vault; Chat recebe somente ID opaco e metadados. Download explícito por mensagem verifica autenticação, Membership, FULL/LIMITED/NONE, hash/tamanho/MIME e flags; Range suportado. Core/Provider usam streams, sem buffers de arquivo inteiro. Chat usa Blob local limitado, revogado ao sair/trocar organização; nunca acessa URL do Provider/WhatsApp.
- Cache Provider AES-GCM, hash validado antes de liberar bytes, TTL 24h; referência recebida até 30 dias, disponibilidade remota não garantida. Upload não vinculado: quota 64/org; referências 2.048/conexão; recibos de envio 1.024/conexão; cache 512 MiB global / 256 MiB conexão, um writer e um transporte multimídia de cada vez. Limpeza não apaga mensagens persistidas. Vault/cache usam chave existente; no logs de conteúdo/keys.

## Contratos e migration

- `GET /api/v1/channels`: canais Web e capabilities efetivas da organização.
- `POST /api/v1/conversations/external`: abrir por contactId **ou** phone E.164.
- `POST /api/v1/conversations/:id/messages`: mediaId opcional; texto/legenda original, clientMessageId obrigatório; PENDING/resultado incerto observável.
- `POST /api/v1/conversations/:id/media`: stream binário e manifest validado.
- `GET /api/v1/conversations/:id/messages/:messageId/media`: stream autorizado e Range, sem cache público.
- `PUT /api/v1/providers/whatsapp-web/connections/:id/capabilities`: providers.manage, flags técnicas e auditoria; não conecta socket nem envia.
- Provider interno assinado: resolução de destinatário, intenção idempotente e upload/download binário por ID; assinatura cobre manifest com hash/tamanho.

Migration aditiva `20261011210000_consolidation_outbound`: Message.deliveryOutcome nullable; ProviderConnection.outboundEnabled/mediaEnabled **false**; Media metadata com chave composta de Channel tenant-scoped e índices. Doze migrations validadas em MariaDB isolado, Prisma/drift e OpenAPI atualizados. Nenhuma migration em produção.

`PROVIDER_OUTBOUND_ENABLED` / `PROVIDER_MEDIA_ENABLED` são false por padrão no Core/Worker e Provider; disponibilidade efetiva exige ambas as camadas, autorização da conexão e RBAC. Históricas conservam seus gates atuais. Nenhum botão contorna flag. Demo continua sem transporte externo.

## B4 — evidências e critérios de aceite

Diretório local: `~/homelab/deploy-records/wapphub-provider-web/20261011-consolidation-b1-b4/`. Suites e CI final são registradas no PROGRESS com SHAs/PRs. Critérios técnicos: P0 reproduzidos/corrigidos; cadeia HTTP/SQL/Worker/Provider/journal com SDK sintético; não duplicação após restart/SQL fault; live durante envio; negativas de tenant/CSRF/RBAC/sessão/org switch; metadata-only/visibilidade/autoria; cache tamper/TTL/hash/MIME; pipeline runtime image/audio/voice/video sem rede; regressões Demo e páginas/realtime; lint/typecheck/build/Prisma/migrations/OpenAPI/CI verdes.

Os testes de mídia executam a imagem real com FFmpeg e preparação real do SDK, mas socket/uploader sintéticos e `--network none`: cinco envios sintéticos, zero reais. Testes Chat são jsdom; **não houve validação gráfica/navegador**. Não comprovam recuperação remota, qualidade de gravação em cada browser, reconexão produtiva ou entrega WhatsApp. Essas verificações pertencem a B5/B6, com autorização específica. [Plano B5](WHATSAPP_WEB_CONSOLIDATION_B5.md).


Validação encerrada B4: Core131/131, Provider90/90, Chat294/294; [CI Core](https://github.com/uillaneduardo/wapphub-core/actions/runs/38179967004), [CI Provider](https://github.com/uillaneduardo/wapphub-core/actions/runs/38179967011), [CI Chat](https://github.com/uillaneduardo/wapphub-chat/actions/runs/38179832791) verdes no SHA funcional registrado no PROGRESS. [PR26 P0](https://github.com/uillaneduardo/wapphub-core/pull/26), [PR27 Core/Provider](https://github.com/uillaneduardo/wapphub-core/pull/27), [PR19 Chat](https://github.com/uillaneduardo/wapphub-chat/pull/19) abertos para revisão, sem merge.
