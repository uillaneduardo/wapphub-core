# P1.1 — upload de voz gravada (em revisão)

Sem merge/deploy ou envio WhatsApp real. Runtime confirmado por OCI:
Core/API/Worker/Provider763981a, Chatbaaee36. Recebimento de imagem/voz/vídeo
homologado pelo usuário; não alterado nesta correção. Core mantém domínio/RBAC;
Provider mantém transporte, codecs e Vault privado. Nenhuma migration/SDK novo.

## Evidência real e limite da conclusão

HAR analisado pelo usuário: 2026-10-13T21:11:47Z, VOICE/audio/webm,
mensagem-de-voz.webm,49459bytes, POST mídia503/MEDIA_UPLOAD_FAILED,
req-1uw,1529ms, preflight204, nenhum POST/messages. Cookies/tokens/bytes não
solicitados nem registrados. Core req-1uw registrado21:11:49.182Z; Provider
REQUEST_FAILED21:11:49.180Z. As outras três falhas na janela21:09–21:15 também
pareiam em2–3ms. É correlação temporal, não um trace ID compartilhado antigo.
Logs antigos não retêm exceção, estágio ou stderr; não é possível afirmar qual
exceção interna específica ocorreu nos49459bytes sem inventar evidência.

## Defeitos comprovados e estágio

`ProviderMedia.upload → probe`: ffprobe pode concluir exit0 e JSON Opus válido
antes de consumir todo stdin. `pipeline` rejeita EPIPE; Promise.all/finally mata
o processo e transforma conclusão válida em erro. No Provider a exceção não é
ServiceError: HTTP503/REQUEST_FAILED. WebProviderClient não aceita esse código,
converte para MEDIA_UPLOAD_FAILED; Chat.uploadMedia repassa503. Reprodução pela
rota HMAC real, imagem publicada/FFmpeg5.1.9, WebM streaming620318bytes/60s:
503/REQUEST_FAILED antes; após correção200/Ogg/Opus. Um ffprobe sintético que fecha
stdin imediatamente reproduz o mesmo erro determinístico em teste unitário.

`ProviderMedia.upload → getAudioDuration`: execução anterior mede WebM antes de
converter, apesar de container streaming não conter Duration. Parser pode retornar
undefined (Math.ceil(NaN) →415MEDIA_CODEC_INVALID) ou RangeError conforme layout/
chunking; RangeError também vira503/REQUEST_FAILED. ffprobe confirmou Opus válido
sem duração. WebM sem duração de48932bytes/5s, semelhante ao tamanho do HAR,
retorna415 no baseline e200 após conversão; não é o arquivo humano nem prova do
mesmo código503 nesse tamanho. O contrato da biblioteca documenta que duration
pode continuar indisponível mesmo com duration:true ([fonte primária](https://github.com/Borewit/music-metadata#ioptions-interface)).

FFmpeg/ffprobe/libopus existem na imagem efetivamente publicada, verificados no
container. Nenhuma evidência de binário ausente, quota/memória esgotada ou hash
corrompido na tentativa humana. O primeiro defeito ocorre na sondagem, o segundo
antes da conversão; não atribuir indiscriminadamente ao encoder FFmpeg.

## Correção localizada

Verificar stream AES/tamanho/SHA antes de iniciar ffprobe e conectar leitores sem
await intermediário que descarte stdout. Permitir apenas EPIPE/premature close na
alimentação; ainda exigir exit0, JSON válido, codecs permitidos. Falhas reais de
processo continuam negadas. WebM válido converte para Ogg/Opus antes de medir
duração. Medir o Ogg final e validar duração positiva≤600; -t601 detecta excesso,
sem truncar silenciosamente gravação longa para600. Usar MIME/hash/tamanho/nome
.ogg convertidos na resposta, Vault e SQL. Não alterar bytes recebidos ou cache de
mídias recebidas. Cache convertido temporário e original em falhas são removidos.

Upload interno recebe cancelamento da conexão, mata subprocesso e libera guard.
Prazo de socket somente nessa rota passa10→60s, compatível com cliente interno;
limites de processos15s probe/30s conversão/1thread/32MiB max_alloc mantidos.
Rota global/conexão WhatsApp/sessão não alteradas.

Diagnóstico sanitizado: Core loggedOperation media.upload distinto de message.send;
request ID do Core encaminhado em header interno técnico validado. Provider registra
RECEIVE/STORE/PROBE/CONVERT/DURATION/PERSIST, tipo, quantidade de bytes, duração,
process exitCode e classificação fixa de stderr. Stderr bruto permanece apenas num
buffer temporário limitado2048chars e nunca é logado. Sem corpo/nome/IDs pessoais,
segredos ou referências. Estágios prontos/falhos são explícitos.

Chat preserva File/Blob da gravação na falha, informa estágio e código seguro e
permite retry usando clientMessageId estável. Upload confirmado é reutilizado se
registro POST for rejeitado antes de commit; evita outro upload/orphan. Resposta
incerta conserva gravação, bloqueia nova intenção e oferece Verificar envio via
REST; não retransmite UNKNOWN. Confirmado pelo Core remove a prévia sem duplicar.

## Validação e rollback

Resultados finais, CI/PRs e métricas na conclusão do progresso canônico. Script
versionado voice-upload-smoke.mjs, executado em CI/runtime real sem rede, testa
VOICE/AUDIO WebM streaming0,04/5/60s, Ogg/header/hash/tamanho/duração;601s negado,
falha/cancelamento e cleanup. media-smoke preserva IMAGE/AUDIO/VOICE/VIDEO com SDK
instalado e envios exclusivamente mockados. Browser gráfico não executado.
Bytes MediaRecorder do usuário indisponíveis; gravação/captura/prévia/upload/retry
cobertos em jsdom com MediaRecorder simulado. Compatibilidade exata de navegador
e envio ao celular ainda exigem homologação humana após deploy autorizado.

Rollback: voltar Core/API/Worker/Provider à imagem media-p1-763981a9feb9 e Chat à
media-p1-baaee362cc16 (ou preservar PR realtime separado), sem restaurar SQL/Vault,
chaves/sessões, histórico ou filas. Schema/Vault permanecem compatíveis; rollback
reintroduz upload WebM defeituoso. Novos Ogg persistidos continuam compatíveis.

Homologação: gravar voz curta e1min, prévia, Enviar; se falhar, ler código/request ID
sem exportar HAR sensível, confirmar gravação preservada e retry. Confirmar uma
mensagem no Chat/celular e clientMessageId estável; negar permissão/trocar tenant
com upload em voo; repetir imagem/vídeo/áudio anexados e recebidos. Nenhum aceite
real presumido pelos testes.

## Arquivos alterados e evidências locais

- services/wapphub-provider-web/src/media.ts: ProviderMedia.probe/upload, stdin,
  duração após conversão, timeout/cancelamento, stderr sanitizado e cleanup.
- services/wapphub-provider-web/src/http.ts e main.ts: socket limitado por rota,
  cancelamento de upload e registro dos estágios.
- src/integrations/web-provider-client.ts, src/application/chat.ts e
  src/http/chat-routes.ts: requestId técnico interno e loggedOperation de upload.
- services/wapphub-provider-web/tests/received-media.test.ts: EPIPE de prober
  bem-sucedido; scripts/voice-upload-smoke.mjs e workflow/provider-web: runtime
  WebM sem Duration, codecs, falha de encoder, cancelamento e cleanup.
- tests/web-provider.test.ts: cadeia Provider/SQL/realtime/WebSocket/replay/REST
  PENDING→SENT→DELIVERED→READ, repetição/atraso e negativas de autorização/tenant.
- Chat Conversations.tsx/ConversationView.test.tsx: File, clientMessageId e
  mediaId em memória; retry e verificação de UNKNOWN; PR31 separada.

Relatórios sanitizados: homelab/deploy-records/wapphub-core/20261013-p12-consistency/.
Core155/155, Provider151/151, Chatvoz360/360; lint/typecheck/build/OpenAPI/Prisma
validados; schema12/zero novo drift (cinco nomes FK preexistentes preservados).
media-runtime-final: SDK real/IMAGE/AUDIO/VOICE/VIDEO e5 envios mockados,zero reais.
voice-http-after: seis uploads reais locais sintéticos por HMAC200, arquivo
convertido verificado;601s/encoder defeituoso/corrompido negados415, cancel499
sem leftover. Na amostra CPU1/RAM512MiB/read-only/networknone: 5s48932bytes em
566–805ms,60s620318bytes em1236–1453ms;601s limite em10820ms, RSS141MiB. São
medidas de ambiente sintético compartilhado, não SLA, navegador ou rede WhatsApp.

Sondagem pode encerrar antes de consumo total; encoder com -t601 também pode
encerrar stdin legitimamente. A tolerância restrita de pipe depende do exit0 e
validações finais. Rejeição de encoder é tratada imediatamente antes de await
da verificação do arquivo, evitando unhandled rejection que derrubaria o processo.
CI dos heads finais é condição de entrega; URLs e conclusão no progresso canônico.
