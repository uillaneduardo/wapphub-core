# Diagnóstico de Integrações e Capabilities

## Objetivo

Permitir ao cliente e ao suporte identificar rapidamente se um recurso está:
- contratado;
- permitido ao usuário;
- configurado;
- suportado pela Meta;
- operacional.

Não usar apenas um booleano "conectado".

## Níveis de validação

### Configuração
Verifica presença/consistência estrutural dos dados necessários.

### Autenticação
Valida se a credencial consegue autenticar no provider.

### Recursos do provider
Confirma acesso à conta/business/número configurados.

### Webhook
Valida configuração e recebimento de eventos.

### Comunicação
Valida saída e entrada.

### Recurso funcional
Valida texto, imagem, áudio e outros recursos individualmente.

## Capability Matrix

Resultado efetivo é explicável:

| Dimensão | Pergunta |
|---|---|
| Permission | o usuário pode executar? |
| Entitlement | a Organization contratou? |
| Provider Capability | a Meta permite/suporta? |
| Channel Configuration | o canal está configurado? |
| Health | componentes necessários estão saudáveis? |

## Estados

Usar estados, não apenas true/false:
- UNKNOWN
- CHECKING
- HEALTHY
- DEGRADED
- FAILED
- DISABLED

## Códigos estáveis

Exemplos:
- META_AUTH_OK
- META_AUTH_INVALID
- META_WABA_ACCESS_OK
- META_WABA_ACCESS_DENIED
- META_PHONE_FOUND
- META_PHONE_NOT_FOUND
- WEBHOOK_CONFIGURED
- WEBHOOK_UNREACHABLE
- MESSAGE_SEND_OK
- MESSAGE_SEND_FAILED
- MESSAGE_RECEIVE_OK
- MEDIA_IMAGE_OK
- MEDIA_AUDIO_OK

Frontend recebe códigos WappHub e mensagens seguras, não erro bruto da Meta.

## Diagnostic Run

Registrar execuções diagnósticas:
- organizationId;
- channelId;
- triggeredBy: USER | SUPPORT | AUTO;
- startedAt;
- finishedAt;
- status;
- checks;
- durationMs.

Manter histórico suficiente para suporte e análise.

## Light Health Check

Barato e frequente:
- Core;
- banco;
- Redis;
- worker;
- fila;
- último webhook;
- último envio;
- último erro;
- validade recente da integração.

Não chamar a Meta desnecessariamente a cada execução.

## Deep Diagnostic

Sob demanda ou em cadência maior:
- validar credencial;
- validar conta;
- validar número;
- atualizar capabilities;
- validar webhook;
- executar teste controlado quando aplicável.

## Teste ponta a ponta

Modo diagnóstico pode acompanhar:

```
Meta → Webhook → Core → Banco → Realtime → Chat
```

e:

```
Chat → Core → Outbox/Queue → Worker → Meta → Status
```

Registrar tempos por etapa quando possível.

## Saúde da fila

Monitorar:
- waiting;
- processing;
- failed;
- oldestJobAge;
- throughput.

Uma API saudável com worker/fila degradada não deve ser reportada como integração plenamente saudável.

## Segurança

Suporte pode ver saúde e códigos de erro, mas não segredos completos.

## Correção CP4 e diagnóstico contextual (2026-10-10)

A mensagem da homologação foi persistida como saída DEVICE, sem atendente, na conversa existente e não atribuída. Zero conversas criadas significa reutilização; contatos contabilizam criação/atualização de identidade. O filtro padrão “Minhas” ocultava a conversa. A correção do Chat abre “Todas” para quem possui supervisão e “Não atribuídas” para os demais, preservando filtros explícitos na URL e as regras do Core.

As duas falhas antigas existem apenas no contador durável do Provider. O adapter anterior contabilizava resultados sem normalização como falhas, incluindo eventos sem mensagem suportada. Não existem detalhes individuais persistidos que permitam atribuir com segurança uma causa a essas duas ocorrências. O painel informa essa limitação, sem inventar eventos, horários ou códigos.

API somente leitura `/api/v1/providers/{WHATSAPP_WEB|DEMO|META}/diagnostics`, `/health`, `/{id}`; listagem por `kind=ERRORS|EVENTS`, `page`, `limit` (1–50), período, severidade, etapa e estado. Exige **providers.manage e providers.diagnostics.read**, Membership ativa e organização da sessão. Migration aditiva concede a permissão apenas à role OWNER que já gerencia providers, sem concedê-la a agentes. Overrides de revogação administrativa continuam prevalecendo. Consultas são auditadas e não acionam o Provider.

O painel reutiliza ProviderInbox (aceitação transacional), ProviderCommand (tentativas/comandos) e ProviderConnection.syncProgress/providerSync (checkpoint). Não há uma nova tabela de logs. Novas falhas do Core retêm até 64 ocorrências sanitizadas/conexão por 30 dias: UUID do evento/correlação, código permitido, componente/etapa/estado, horários reais, tentativas e quantidade de itens; nenhum payload ou identidade externa. Recuperação usa a mesma ocorrência após o commit de retry. Rejeições por item não interrompem o lote; ficam marcadas como REJECTED. Dead-letter só é informado depois da quinta entrega malsucedida e confirmação do nack pelo journal. Se o banco também estiver indisponível para o diagnóstico, o detalhe não pode ser prometido; o Worker registra apenas SYNC_DIAGNOSTIC_WRITE_FAILED.

A janela de consulta considera até 200 eventos Inbox, 50 comandos e 64 ocorrências dos últimos 30 dias; paginação ocorre sobre essa janela determinística. `truncated` sinaliza limite/evicções e os contadores ativos/recuperados descrevem a janela, não um total global. Índices de organização/conexão/horário e de eventId limitam consultas. Retenção de detalhes expira logicamente em leitura e fisicamente na próxima escrita do checkpoint; não apaga as chaves Inbox necessárias à idempotência. Inbox contém apenas metadados/hash, sem conteúdo. Demo/Meta sem journal compatível retornam ausência de registros, não métricas simuladas.

Contadores do Core passam a separar itens aceitos em lotes commitados, itens processados, duplicidades, rejeições, conversas localizadas, tentativas malsucedidas e falhas pendentes conhecidas. Eles não comprovam que todos os itens foram mensagens novas. O adapter preparado separa recebidos/normalizados/ignorados/rejeitados/falhas e lotes publicados/confirmados; dados anteriores permanecem classificados como legados sem detalhes.

A publicação inicial da correção pode atualizar apenas Core e Chat, preservando o container Provider em execução para respeitar a proibição de reconexão automática. Nesse caso, a classificação detalhada na origem permanece preparada e testada, mas não ativada; o painel continua útil para Inbox, comandos, falhas/retries novos do Core e contadores legados observados. Histórico, envio e download permanecem desativados; CP4 aguarda homologação funcional pelo usuário.

## Autoria e transparência operacional

Message já conserva senderUserId/senderContactId, direction, historical, body/transmittedBody e referências externas. O contrato canônico exige userId somente para origem WAPPHUB; DEVICE/CONTACT não podem declarar autoria interna. Nenhuma migration adicional é necessária para autoria. O REST acrescenta `senderName` nullable por relações existentes, usando joins/buscas em lote após as regras de visibilidade. O ID do autor original permanece imutável; renomeação do User altera o nome de exibição associado a esse ID, sem reescrever mensagens ou inventar snapshot histórico.

Chat exibe senderName interno somente com senderUserId persistido; saída sem autor não tem nome/rótulo substituto. Recebidas mostram o contato disponível. Nome da sessão atual é usado exclusivamente na mensagem otimista de um envio iniciado por esse usuário; histórico nunca herda esse nome. Prefixos como *Maria:* pertencem ao corpo original, com formatação preservada. Providers, códigos e bindings permanecem nos contratos/banco, mas badges e nomes técnicos são removidos de Inbox, cabeçalho, balões e contatos; capacidades e estados funcionais continuam. Identificações técnicas ficam em Provedores/diagnóstico; simulador conserva URL/permissões com rótulo funcional neutro.

Um contato real ainda usa o placeholder técnico legado. O serializer neutraliza somente esse nome gerado (providerName ausente e identificador interno do adapter), mostrando Contato; nome original e identidades no banco permanecem intactos. Nomes explícitos do contato são preservados.
