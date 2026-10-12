# Gerenciamento simplificado do vínculo WhatsApp

Implementação autorizada em12/10/2026; publicação/homologação dependem dos gates registrados no progresso canônico.

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
