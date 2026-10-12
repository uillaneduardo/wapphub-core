# Gerenciamento simplificado do vínculo WhatsApp

Publicado em 12/10/2026 às14:55UTC: Core/Worker/Providerc90099b e Chatdd731cb. CI133/125/322 e smokes aprovados. Homologação humana pendente, sessão parada/logoutUNCONFIRMED; ver progresso canônico.

## Fluxo e contratos existentes

Chat deriva uma apresentação tipada de lifecycle, transporte confirmado, revisão/última verificação e operação persistida. Uma ação contextual: Vincular WhatsApp, Restabelecer conexão (recover com confirmação) ou renovar QR realmente expirado. Desvincular WhatsApp envia logout explícito; parada local disconnect permanece em diagnóstico avançado recolhido. Atendimento/histórico são controles separados. Nenhuma operação sensível começa no carregamento. QR só em memória/SVG, expiração monotônica/contador, abort e limpeza ao trocar contexto. Realtime + REST existente; timer local invalida confirmação velha sem polling ao Provider.

Vincular consulta o Core, reutiliza registro ou cria via outbox. O gesto acompanha recibo create/prepare_link até COMPLETED antes de emitir connect com a versão conciliada. Não conecta enquanto create está PENDING/PROCESSING, não faz retry cego após409 e não persiste intenção destrutiva no browser. Fechar a aba não cancela comandos já autorizados; uma continuação não enviada exige novo gesto após retorno.

## Preparação segura de uma nova vinculação

Adição pequena ao endpoint existente commands: action prepare_link, confirmed=true, expectedVersion e removedOnPhone boolean opcional. Core exige providers.manage, sessão/Origin/CSRF/Membership/tenant, elegibilidade confirmada pelo Provider e confirmação de remoção pelo celular quando necessária. Payload existente leva controlVersion/removedOnPhone ao Worker, que reautoriza antes da chamada HMAC. Auditoria registra ator/escopo/comando/declaração, sem auth/QR. Idempotência verifica também a declaração de remoção.

Provider revalida: sem socket/desired, estado parado elegível, sem falha de armazenamento. Evidência automática só logout remoto CONFIRMED ou SESSION_REVOKED com código401 registrado;403/SESSION_REPLACED/BAD_SESSION exigem declaração explícita de remoção no celular. Ausência de socket nunca comprova revogação. Parada local isolada não permite aposentadoria.

prepare_link não acessa WhatsApp: dentro do mesmo Vault AES-GCM, arquiva auth/Signal anterior com comando/data/prova e desassocia o material da sessão corrente atomicamente; preserva journal/checkpoints/recibos/history/referências/lifetime attempts. Máximo2 sessões aposentadas, sujeito às quotas8MiB/registro e64MiB total; limite bloqueia outra aposentadoria, sem apagar automaticamente o diagnóstico. Não há migration ou nova fila. A sessão anterior nunca é reutilizada. Preparação desabilita capacidades de envio/mídia da nova sessão; requer nova ativação humana.

## Primeiro pareamento sob proteção de produção

ALLOW_SESSION_CONNECT continua obrigatório e PROVIDER_LINKED_RECOVERY_ONLY permanece true. Somente connect explícito e versionado de um escopo sem vínculo válido registra autorização curta120s para QR; Sessions transmite permissão efêmera ao factory Baileys desse escopo. O guard global permanece para todas as demais sessões. Refresh só durante episódio autorizado; autenticação retira autorização; stop/logout a cancelam; restart interrompe pareamento ainda não autenticado sem gerar novo QR. A sessão produtiva esgotada ou com logout incerto não recebe autorização automaticamente. Recover conserva tentativa única/deadline120s/open+30s/no replay.

## Rollback e riscos

Campos Vault aditivos; rollback Provider deve compreender retiredSessions/pairingAuthorization e preservar fencing, receipts, UNKNOWN e logout intent. Nunca restaurar auth/Signal antigos nem CP4.7 automaticamente. Preferir imagem da mesma implementação com capacidades fechadas; Core/Chat anteriores não consomem prepare_link e só podem voltar com bloqueio de novos comandos. Schema12 permanece instalado.

WhatsApp pode rejeitar credenciais ou não fornecer histórico; teste sintético não homologa sessão real. Declaração de remoção pelo celular é decisão administrativa explícita, auditada; Codex não confirma pelo usuário. Limite de arquivo exige política posterior de retenção/autorização para mais de duas substituições, sem limpeza automática nesta entrega. Homologação visual/manual no notebook, sem browser no homelab.

## P0 — reconciliação e janela de recibos (12/10/2026)

O Worker continua verificando o Provider; lastCheckedAt pode mudar sem evento realtime quando o estado permanece igual. O Chat revalida ao expirar a confirmação de30s, com fallback de30s apenas na página visível e reconciliação por foco/visibilidade/rede (mínimo10s). Consultas concorrentes são coalescidas, abortadas na troca de contexto e limitadas pelo cliente GET existente a15s. Versões ou timestamps mais antigos não substituem snapshots recentes. Erro de consulta é separado de erro de comando; somente transporte confirmado e verificação recente permitem Conectado. Verificar novamente fica disponível quando a consulta falha/vence. Nenhuma consulta autoriza comandos, QR, preparação ou recuperação.

A operação pública inclui createdAt/updatedAt/attempts/nextAttemptAt, extraídos do outbox existente. Após120s sem resultado, a UI explica a incerteza e oferece verificação, mantendo o bloqueio a novas operações; não declara falha ou sucesso por idade. Recibos COMPLETED/FAILED conciliados por REST retiram o spinner, mesmo sem realtime. Fluxos create/prepare_link só seguem para connect mediante intenção atual do usuário e recibo da mesma identidade; refresh da página não os reinicia.

O Vault preserva uma janela limitada de256 recibos. Comandos administrativos com controlVersion monotônico podem rotacionar essa janela; o fence durável rejeita comandos evictados com versões anteriores, antes de qualquer mudança/rede. Comandos sem versão continuam sujeitos a SESSION_COMMAND_LIMIT. O Core preserva esse código e o trata como permanente, sem retries inúteis. Histórico mantém seus gates e orçamento; nenhuma autorização antiga é ampliada. Credenciais de produção não são aposentadas na publicação.

Para logout UNCONFIRMED, Vincular WhatsApp só aparece depois da confirmação recente de preparationEligible pelo backend. Quando removalConfirmationRequired, um checkbox desmarcado exige a declaração humana de remoção pelo celular; a confirmação fica desabilitada até essa declaração. removedOnPhone nunca é inferido da elegibilidade nem enviado por reconciliação. A declaração não é comprovação remota: sua natureza continua registrada no Vault/auditoria. Desvincular segue secundário; diagnóstico técnico recolhido.


## P0 primeiro QR — atualização técnica12/10/2026

Primeiro pareamento sem identidade usa CONNECTING/GENERATING_QR, nunca RECONNECTING. Prazo para o primeiro QR30s (socket usa connectTimeout20s), prazo total120s da autorização; socket/QR indevidos ou falha transitória encerram o episódio, sem consumir/resetar recoveryFailures. attempts preserva todas as inicializações. Nova tentativa exige novo gesto/identidade de comando/fencing; duplicata não inicia rede. QR20s/revisão/autorização são revalidados; refresh somente dentro do episódio e após expiração contextual. Scan seguido de515 autoriza exatamente um transporte de conclusão usando identidade recém-persistida/allowPairingfalse/prazo restante, sem novo QR. Reconexão autenticada mantém budgets/backoff/recuperação explícita e reset após30s estáveis.

Erro RECONNECT_LIMIT anterior não comprova vínculo. Core só permite novo connect nesse caso se elegibilidade sem vínculo veio do Provider há menos de30s; estados revogado/substituído/BAD_SESSION continuam bloqueados. Reinício interrompe pareamento e preserva causa terminal/recibos/tentativas/credenciais, sem repetir QR. Observações de SDK são enums/códigos sanitizados; payloads/mensagens de erros não são gravados.

PROVIDER_PAIRING_WEB_VERSION é pin opcional de configuração, formato2,3000,revisionUInt32. Quando configurado, aplica-se somente a novo pareamento autorizado, sem consulta automática ou mudança de versão de sessão autenticada. Revisão pública sw.js1050063423 foi conferida em12/10/2026, defaultBaileys7rc14=1043857760; diferença não comprova a causa de um encerramento428. Pin exige validação/revisão operacional em futuras entregas, não atualização silenciosa. O QR e aceite remoto só serão comprovados pela homologação humana; ver progresso e relatórios20261012-p0-first-pairing/.
