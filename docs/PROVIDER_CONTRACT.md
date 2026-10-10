# Contrato interno universal de providers — checkpoint 1

Atualização: versão RC14 autorizada; [checkpoint2](WHATSAPP_WEB_CHECKPOINT2.md)
reutiliza esta fonte única em serviço independente, com auth/queues locais.
Contrato CP1 e operações públicas Core permanecem iguais; consumer Core ainda não ativado.

Fonte única: `contracts/provider.ts`, TypeScript/Zod, independente de qualquer SDK.
A publicação deste checkpoint não instala nem habilita WhatsApp Web, mídia, filas,
QR, credenciais, novos endpoints ou novas operações do Worker.

## Envelope versão 1

Campos comuns: version=1, eventId e correlationId UUID, organizationId UUID,
connectionId UUID (corresponde ao Channel resolvido pelo Core), provider,
occurredAt ISO8601 com fuso, deduplicationId SHA256 e capabilities explícitas.
`parseProviderEvent` valida objeto ou JSON, allowlist estrita e limite de 64 KiB.
Falhas têm códigos genéricos e não carregam payload/segredos/issues do validador.
É contrato serviço-a-serviço; não substitui o envelope realtime público do Chat.

Eventos: message.received, message.sent, message.updated, message.failed,
message.deleted, connection.updated e media.updated. Recepção/envio distinguem
direção, contato/WappHub/dispositivo, identidades externas, IDs internos opcionais,
clientMessageId, conteúdo original/transmitido e estado. Origem externa não pode
atribuir userId de atendente. Sender interno requer userId; entrada requer contato.
Esse shape não autoriza operações: Core deverá resolver Channel/Organization,
revalidar relacionamentos e aplicar suas regras antes de qualquer persistência.

Receipts usam estado normalizado. Falha separa NOT_SENT e UNKNOWN, evitando
assumir que erro de transporte implica ausência de entrega. Deleção só é aceita
quando capabilities a suportam; o serviço de aplicação ainda não processa esse evento.
Conexão inclui estado, revisão/expiração do QR e código de erro seguro; QR/auth não
integram o barramento. Media contém ID, tipo, MIME, nome limitado sem path/control,
tamanho até25MiB, estado, hash opcional e referência opcional de miniatura.
Nenhuma URL externa, bytes/Base64, payload bruto ou credencial é permitida.
As validações de bytes/MIME/arquivo reais pertencem ao checkpoint de armazenamento,
ainda não implementado; metadados não substituem a inspeção do conteúdo.

## Deduplicação e conteúdo

`providerDeduplicationId` vincula tenant, conexão, provider, tipo, ID externo e
revisão do evento (por exemplo DELIVERED/READ). Hash de array JSON evita colisões
por delimitadores. Chave não é autorização nem confirmação de processamento.
Dedup/ack/recovery duráveis serão implementados no próximo checkpoint; não há
fila ou Inbox de integração ativada neste checkpoint.

`normalizeText` preserva conteúdo exatamente, incluindo espaços, linhas e Unicode;
nenhum trim/normalização de Unicode ou assinatura. `presentText` oferece política
explícita facultativa de apresentação, mantendo originalBody e transmittedBody
separados. Limites de nome/texto e caracteres de controle são validados. A política
não está exposta no Chat nem persistida no Channel neste checkpoint; nenhum
atendente recebe assinatura obrigatória. Implementação de configuração pertence
à integração futura e não altera body original de mensagens M1.

DemoProvider/MessageIngestionService reutilizam a normalização de texto. Demo
mantém parseInbound DTO, receipt DTO e IDs determinísticos antigos. Suas
capabilities imutáveis indicam só TEXT, receipts locais, sem exclusão/grupos ou
protocolo não oficial. Nenhuma funcionalidade futura é anunciada como disponível.
Schema, permissões efetivas/padrão, autoria, isolamento, histórico, CSRF/Origin,
OpenAPI, rotas e realtime existentes permanecem inalterados.

## Validação

84 testes Core passaram, incluindo9 novos contratos: sete tipos, conteúdo exato,
assinatura facultativa, dedup escopada/revisões, autoria/direção negativas,
rejeição de segredos/QR/raw/bytes/URLs, tamanho/erros seguros, referências de mídia
 e compatibilidade Demo. Regressões completas M0/M1/M2.1 em banco/Redis isolados.
Lint/typecheck/build/Prisma/OpenAPI/drift e npm ci aprovados (0 vulnerabilidades).
OpenAPI gerado é idêntico ao publicado; migrations nenhuma, baseline de cinco
nomes de FK M1 permanece igual, sem execução do SQL de diff.

Microbenchmark sintético: 3000 parse/validações,20 tenants, máximo1286bytes/evento,
165.20ms total; p50 0.0486ms/p95 0.0846ms/p99 0.1130ms; CPU user238.26ms/system7.945ms;
RSS117424128→130531328bytes. Apenas normalizador em memória, sem rede/fila/mídia/
conta/WhatsApp; não mede capacidade de agentes, API/realtime ou SLA. Script reproduzível
em scripts/provider-normalization-bench.ts; evidência externa em deploy-records.

Auditoria, riscos, infraestrutura, migrations futuras e rollback:
[WHATSAPP_WEB_AUDIT.md](WHATSAPP_WEB_AUDIT.md). Etapas seguintes aguardam resolução
da versão Baileys (RC7 mantida versus requisito de estável;6.x sem manutenção).
