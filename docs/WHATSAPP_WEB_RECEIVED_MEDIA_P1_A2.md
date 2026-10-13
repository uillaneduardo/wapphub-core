# P1 — mídia recebida: diagnóstico A0/A1 e proposta A2

Estado da análise original: A0/A1 validados tecnicamente. A2 aprovada pelo usuário em 2026-10-13; implementação, merges e deploy autorizados. Ver WHATSAPP_WEB_RECEIVED_MEDIA_P1.md para a execução. Data: 2026-10-13. Nenhum código funcional alterado, commit/PR/merge/deploy executado nesta análise. Apenas documentos de análise/progresso modificados. Core 41fdf6a preservado, sem alteração de conexão/autenticação/filas/sync/autoria/assinatura/envio.

## A0 — estado real

| Componente | Git local | Imagem em execução | Revision OCI |
| --- | --- | --- | --- |
| Core | fix/whatsapp-bootstrap-live-recovery,9435ed4 | wapphub-core:recovery-41fdf6a,API/Worker | 41fdf6a4a3c0991dd04faba2ea79742733a66b89 |
| Provider | services/wapphub-provider-web no Core | wapphub-provider-web:recovery-da15c3b | da15c3b04e90fdace32dcf7977336a3bcda4358d |
| Chat | main,1b3219b | wapphub-chat:qrfix-dbab1ae | dbab1aec709b9a3026079ad3dbce1d2dabfd7192 |

Main/origin Core 41861c4; fixes da recuperação ainda não integrados. Remote branch 9435ed4 e Chat main 1b3219b conferidos via ls-remote. Working trees inicialmente limpas. Diferenças das fontes frente aos runtimes são documentais. Compose renderizado a partir dos labels e arquivos efetivos de cada projeto, com imagens conferidas; config/env completos permanecem privados. Seis serviços essenciais healthy; 40 containers mantêm IDs/imagens/StartedAt. Sessão ativa CONNECTED/attempts 15 / qrRevision 2, histórico on-demand false, flags de mídia Core/Worker/Provider = true, conexão SQL mediaEnabled = true; filas SQL/journal/sync/dead = 0. Relatório da recuperação, AGENTS dos dois repositórios/Provider, arquitetura/segurança/contratos/multimídia/STATUS/progresso lidos.

## A1 — ponto da falha e evidência

1. Banco produtivo, somente leitura:16 INBOUND com mídia,4 IMAGE e 12 VOICE. Todas com metadataReference válido, MIME permitido e compatível, size dentro do limite e SHA256 presente. Não há amostra real AUDIO/VIDEO nesta consulta.
2. Vault ativo:6 registros, todosIMAGE; nenhuma referência privada e nenhum registro/cache corresponde aos16 mediaIds recebidos. Registros existentes não expirados, quota 2048 longe do limite. Cache criptografado total938.654 bytes / 8 arquivos, nenhum .part. Portanto a falta do registro antecede a tentativa de download; cache expirado/download remoto/browser não explicam o404 desta amostra.
3. GET real assinado Core→Provider para IMAGE/VOICE retorna404 MEDIA_UNAVAILABLE em 257 / 250 ms. `services/wapphub-provider-web/src/media.ts:38–40`, `record()`, não encontra `id` ativo no Vault. `read()` interrompe antes de `downloadContentFromMessage` e antes de enviar bytes. Mídia habilitada e HMAC válido; erro não é falta de permissão do atendente.
4. `ProviderMedia.retain()` em `media.ts:19–35`, especialmentelinha23, retorna silenciosamente se o directPath contém `?` porregex `^/[^\s\\?#]{1,1800}$`. Também ignora uma referência contendo somente URL porque exige directPath. O SDK instalado Baileys 7.0.0-rc14 aceita directPath ou URL (`lib/Utils/messages-media.js:405–425`); getUrlFromDirectPath conserva a query.
5. Reprodução isolada com classes/rotas existentes e HMAC local, sem socket WhatsApp: para cada IMAGE/AUDIO/VOICE/VIDEO, plain-path retém registro e fornece 200 com bytes/MIME/SHA corretos pelo cache local. Query-path e URL-only com chave32 bytes, size/SHA/MIME válidos normalizam metadados mas não retêm referência e retornam 404. São 12 casos, 4 controles 200 e 8 reproduções do defeito. Organização estrangeira retorna404 SESSION_NOT_FOUND. Nenhuma função da aplicação modificada.
6. `baileys.ts:183–187` chama retain antes de submeter metadados; o retorno silencioso ainda permite que o sync.batch siga. `normalizeSyncMessage` gera mediaId determinístico por org/conexão/chat/mensagem e o mesmo valor é usado pelo retain. `MessageIngestionService` copia content.media para Message.mediaMetadata. GET recebido usa esses metadados, não depende de criar linhaSQLMedia de upload; a ausência de linha Media recebida não é a causa.
7. `WebProviderClient.readMedia`, linhas63–70, troca todo erro por WebProviderErrorMEDIA_UNAVAILABLE com status padrão503. Reprodução 404 interno → 503 cliente confirmada. `Chat.messageMedia:861` também converte qualquer exceção Provider para 503. Assim,404observado diretamente no Provider é diferente do503resultante na API pública quando chega a esse RPC. Core também pode produzir 404 antes do RPC por metadata/capability/visibilidade em857/859/867; autorizaçãoFoundation continua distinta,401/403. Não atribuir um404de visibilidade à falta de arquivo.
8. Revalidações de Organization/Membership/permissions/visibilidade antes e depois do fetch já existem em Chat.messageMedia 853–870; tamanho/hash/MIME são comparados. Baseline isolado prova 403 tenant e 404 visibilidade sem baixar bytes. Não há evidência para flexibilizar acesso.
9. `MessageMedia.tsx` já tem imagem ampliável e audio/video controls após clique; porém espera Blob completo e mostra a mesma mensagem para qualquer falha. Native players não usam HTTP Range do Core nesse caminho. Range200/206/416 já funciona no baseline Core, mas o loop da rota continua consumindo além do fim selecionado.
10. Cancelamento: em resposta rejeitada, o cliente não cancela body; destruir seu Readable antes de iniciar consumo também não cancela o body remoto porque o finally só existe dentro do gerador. Ambos reproduzidos com fetch/ReadableStream sintéticos, sem rede. Abort de browser não é propagado pelo caminho route→Chat→client→Provider→PrivateFiles; somente timeouts. Arquivos temporários .part atuais = 0, mas faltam garantias de cancelamento imediato.

Limite da prova: os envelopes originais das 16 mídias não foram guardados. Não se pode afirmar se cada mensagem real tinha query, somente URL ou informação criptográfica ausente. Auditoria offline do backup criptografado pré-limpeza encontrou uma referência bootstrap decodificável sem mídias e 13 payloads ausentes; não recuperou envelopes de imagem/voz. Não houve importação ou consulta histórica. Confirmada a ausência de retenção e a condição exata do 404; confirmado o bug de compatibilidade do retain por reprodução. Acrescentar diagnóstico técnico sanitizado do motivo de descarte permitirá verificar a próxima mídia recebida após eventual publicação autorizada. Não expor paths, URLs, keys, conteúdo ou identidades em logs.

## A2 — proposta mínima para aprovação

### B1 obrigatório — eliminar descarte de referência válida e erros opacos

- Em ProviderMedia, aceitar caminho relativo válido com query preservada integralmente. Validar contra a origem HTTPS fixa já usada, mmg.whatsapp.net: sem URL arbitrária, esquema/host/porta/credenciais/fragmentos/paths protocol-relative, controles ou backslashes. URL-only será convertida para path+query somente se corresponder à mesma origem permitida. Redirects continuam bloqueados. Chave32 bytes, hash, size, tipo/MIME e limites conservados. Usar mediaId determinístico atual, referência criptografada no mesmo Vault e PrivateFiles existente. Diagnóstico sanitizado quando a referência não puder ser retida; sem baixar binários no ingress nem alterar o processamento da mensagem.
- Preservar validade de referências existentes e distinguir registro ausente de referência expirada. Cache ausente/expirado com referência ainda válida continua permitindo download sob demanda e verificação completa. Sem reupload, importação histórica, nova pipeline ou restauração de filas.
- WebProviderClient e Chat.messageMedia propagarão apenas códigos e status de mídia permitidos. Erros de serviço/auth interno permanecem erro de infraestrutura; sessão/Membership/RBAC do usuário continuam nos guards existentes. Preservar 404 para recurso inexistente/invisível sem revelar outro tenant. UI recebe mensagens distintas para expiração, indisponibilidade, formato/integridade e falha temporária. Nenhum corpo/stack do Provider é repassado.
- Propagar AbortSignal e fechamento de resposta pelo caminho existente; cancelar fetch/reader mesmo se não consumido e destruir streams/processos na interrupção. PrivateFiles.put usa o mesmo finally para excluir.part e liberar writer. Não liberar bytes até verificação integral de hash/tamanho/MIME; nenhum temporário plaintext persistente.

### B2 separado — uso dos players já existentes

- Imagem: manter carga sob demanda, indicador, visualização/ampliação e Blob limitado/revogado; link de download opcional.
- Áudio/voz/vídeo: manter controles nativos, sem autoplay; somente ao abrir, validar acesso com GET Core Range mínimo e passar URL pública autenticada do Core ao player com credenciais de cookie/CORS apropriadas. URL contém IDs da conversa/mensagem, nunca tokens ou endereço interno do Provider. Requisições Range continuam autorizadas no Core em cada pedido. Troca de tenant/unmount encerra player/requisições e remove fonte.
- Reutilizar206/416 existentes, finalizar stream ao completar range e preservar cancelamento/integridade. A primeira abertura pode exigir download/cache completo verificado no Provider; Range ajuda transferência/seek depois dessa verificação. Sem download automático de todas as mensagens, galeria ou serviço novo. Volume/progresso/duração via controles nativos; velocidade só se compatível e como melhoria separada do 404. Formato não reproduzível tem mensagem e download opcional.

### Arquivos previstos

| Área | Arquivos | Mudança |
| --- | --- | --- |
| Provider | src/media.ts,src/private-files.ts,src/http.ts | retenção/ref valida, erros, abort/cleanup |
| Core | src/integrations/web-provider-client.ts,src/application/chat.ts,src/http/chat-routes.ts | status/code permitido, cancelamento, range/contrato |
| Chat | src/features/conversations/MessageMedia.tsx,src/lib/chatApi.ts,src/lib/api.ts e CSS se necessário | mensagens de erro/carga/player autenticado sob demanda |
| Testes/docs | suites de mídia/provider/client/Chat,OpenAPI,STATUS/progresso/multimídia | regressões antes/depois e evidências |

Nenhuma mudança planejada em autoria/assinatura/outbox/dedup/filas/sync/conexão/credenciais/flags operacionais/schema. Sem migration prevista. Ajuste de histórico/retenção de mensagens permanece fora do escopo.

### B3 — testes e gates depois da aprovação

IMAGE/AUDIO/VOICE/VIDEO: query/URL-only permitido, path simples, MIME com parâmetros, persistência/restart e mesmo mediaId, referência antiga válida/cache vencido, referência ausente/expirada, download falho, conteúdo/MIME/codec incompatível, SHA/tamanho inválidos, abort antes/durante consumo/download e.part/writer liberados. Rejeitar URL/host/redirecionamento/fragmento/controles e escopo errado. Provar autorização antes/depois de fetch, sessão expirada, Membership suspensa/permissions ausentes, Organization trocada e FULL/LIMITED/NONE.

HTTP200/206/403/404/416/503 e contratos aplicáveis401/409/410/413/415/429. Testes Range aberto/sufixo/inválido/fora de limites e cancelamento. Testes jsdom para carga só por clique, image/audio/voice/video controls, erro específico, cleanup/troca de tenant, fontes somenteCore. Sem navegador gráfico/Playwright.

Executar suites completas de Core/Provider/Chat e lint/typecheck/build; OpenAPI e Prisma/status/drift no banco isolado. Não executar migration produtiva. SDK/socket/download sintéticos ou runtime Docker --network none. Regressão preserva os comportamentos corrigidos deCore 41fdf6a, inclusive assinatura, bootstrap e live.

### Impacto, riscos e compatibilidade

Snapshot inicial ProviderCPU 5,68% / memória Docker 90 MiB; Worker 13,92% / 113,6 MiB; API 1,32% / 95,85 MiB. Cache 938.654 bytes, zero .part. Não houve benchmark extensivo. Acrescentar referências consome metadata limitada no Vault, sem binários durante sync. Mantidos 2048 referências/conexão, cache 512 MiB global / 256 MiB conexão, referência 30 dias / cache 24 h e limites 8/16/25 MiB. Download/hash/decrypt ocorre por ação de leitura, com backpressure e limite de concorrência existente. Range pode multiplicar leituras/verificações; medir depois com fixtures, sem comprometer ingestão ou liberar bytes não verificados. Primeira abertura não tem garantia de disponibilidade remota.

Antigas com metadados e referência privada válidos devem continuar abrindo; testar. Metadados/SHA sozinhos não permitem reconstruir chave/path já descartados. As 16 sem referência não são recuperáveis automaticamente apenas com esta correção; serão tratadas como indisponíveis até existir referência proveniente de entrega legítima, sem solicitar história ou envio real por automação. Formatos/codec/browser e playback real exigem homologação humana no notebook após deploy posteriormente autorizado.

### Git, PRs e rollback

Após aprovação, criar branch Core a partir de 9435ed4, incluindo 41fdf6a e fixes publicados; não partir de main 41861c4 descartando recuperação. PR stacked com base fix/whatsapp-bootstrap-live-recovery mantém diff P1 revisável; integração dessa base à main é dependência registrada. Chat branch a partir de main 1b3219b. Commits separados: retenção/erros/abort e experiênciaRange. PRs revisáveis, sem merge/deploy automático.

Rollback futuro da aplicação: Core API/Worker para `recovery-41fdf6a`, Provider para `recovery-da15c3b` e Chat para `qrfix-dbab1ae`, IDs exatos emruntime-before.json. Conservar banco, Vault, chaves, volumes e novas referências válidas; formato do Vault continua compatível. Não restaurar filas/mensagens antigas nem excluir cache/volumes genericamente. Não executar rollback/deploy nesta fase.

## Evidências e resultado desta etapa

Baseline Core 4/4 (permissões/CSRF/sessão, criação, cadeia de assinatura/envio sintético e mídia200/206/416/tenant/visibilidade), Provider 14/14, Chat 4/4, todos aprovados. Reprodutores adicionais: 12 casos de retenção e 2 cancelamentos, usando código atual e arquivos externos ao repo. Depois da correção ainda não executado: A2 pendente. Nenhuma suite completa alegada como repetida nesta análise; suites completas são gate B3 após aprovação.

Artefatos em `/home/uillan/homelab/deploy-records/wapphub-core/20261013-p1-received-media-a0-a2/`: runtime-before.json,runtime-preservation.json,core-metadata-summary.json,vault-media-summary.json,provider-media-get.json,retain-reproduction.json,client-cancel-reproduction.json,offline-protocol-evidence.json,storage-before.json,resources-before.jsonl e logsbaseline. private/ contém apenas config/probes/IDs e cópias criptografadas protegidas, sem divulgação de chaves ou mensagens. Relatório de referência da recuperação lido e preservado.

Próxima ação depende da aprovação expressa A2: implementar/testar e abrirPRs. Produção permanece nas imagens conferidas; publicação/homologação real são gates posteriores.
