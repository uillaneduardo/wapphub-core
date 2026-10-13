# P1 — mídias recebidas / execução da A2 aprovada

Estado: **PUBLICADO — AGUARDANDO HOMOLOGAÇÃO REAL DE MÍDIA.** Deploy 2026-10-13T19:32:51–19:33:19UTC (27,38s). Homologação visual/WhatsApp real ainda pendente. A autorização de 13/10 inclui commits, PRs, merge com CI/revisão aprovados e deploy; não permite envio real, logout ou novo pareamento por automação.

## Causa e correção

Amostra produtiva A1: 16 mensagens recebidas (4 imagens/12 vozes), metadados válidos, nenhuma referência privada correspondente. ProviderMedia.record devolve 404 antes do download. Retain rejeitava query e URL-only; os envelopes originais já não existem, portanto a forma de referência de cada mídia antiga não é conhecida. Novos testes reproduzem e corrigem os dois formatos para IMAGE/AUDIO/VOICE/VIDEO.

Referência aceita somente em HTTPS mmg.whatsapp.net, sem porta/credenciais/fragmentos/controles/backslashes/traversal; query preservada. URL-only convertida para path privado. Chave32 bytes, SHA, MIME, limites, UUID determinístico, quotas e TTL mantidos. Razões de rejeição/retenção são códigos fechados nos diagnósticos existentes; nenhum URL/key/ID/conteúdo é logado. Referência continua criptografada no Vault. Reentrega legítima renova referência consistente; conflito não sobrescreve integridade.

Revisão do SDK rc14 revelou que getHttpStream ignora signal e redirect e que destruir o Transform não fecha a fonte. Patch de três trechos exatos, aplicado no postinstall e verificado contra versão7.0.0-rc14, conserva opções/cancela respostas rejeitadas/fecha upstream. Instalação falha se versão/contexto mudar; atualizar SDK requer revisar/remover patch. Testes executam helper real, descriptografia sintética e redirect HTTP local sem seguir outro servidor. Não há interceptação global de fetch no runtime nem alteração de regras de sync/envio.

Cancelamento segue navegador → rota Core → Chat → fetch HMAC → rota Provider → SDK/cache. Cliente adquire reader imediatamente e cancela mesmo antes de consumir. PrivateFiles remove .part incompleto/libera writer, preserva cache válido e verifica SHA/tamanho/MIME antes dos bytes. Erros de mídia permitidos mantêm404/410/409/413/415/429/408/503; falha de autenticação interna permanece503. Guards e revalidação tenant/Membership/visibilidade continuam401/403/404 conforme contrato, sem expor outro tenant.

Core interrompe consumo ao completar Range e devolve206/416 com Content-Range; GET200 continua. CORS credencial habilita Range e expõe Content-Range apenas às origens configuradas. Chat carrega imagem via Blob sob demanda e revoga ao trocar contexto; áudio/voz/vídeo validam GETRange0-0 antes do player nativo crossOrigin=use-credentials com URL pública Core sem token. Cada Range reautoriza. Controles nativos, velocidade de áudio, download/ampliação e erros específicos; sem autoplay/carga global de conversa.

## Segurança operacional e regressão

Base Core9435ed4 preserva Core41fdf6a (assinatura com uma quebra, bootstrap/live, cursor e snapshots). Integração anterior PR38 merged após workflows Core/Provider verdes, sem deploy intermediário. Chat parte de main1b3219b. Nenhuma mudança em schema, migrations, filas, autoria, dedup, configuração ou credenciais. Nenhum dado descartado.

Backup lógico MariaDB single-transaction e Vault criptografado quiescente, configurações/segredos protegidos em /home/uillan/homelab/backups/wapphub-core/pre-media-p1-*. Manifest SHA256/gzip verificados. Restauração SQL isolada --network none/tmpfs:12 migrations,26 tabelas,425 mensagens; Vault isolado:1 identidade autenticada,6 registros/caches com integridade válida. Nenhum snapshot restaurado sobre produção. Worker/Provider reiniciaram na mesma imagem após backup, CONNECTED/QR preservado.

Artefatos e resultados completos: /home/uillan/homelab/deploy-records/wapphub-core/20261013-p1-received-media-implementation. Baseline: filas/dead/sync/outbound0; CPU API0,01%/Worker12,31%/Provider12,89%/Chat0%; working-set109/117/107/5MiB. Snapshot pontual, não benchmark. Cache A1≈939KB; mantidos256MiB/conexão512MiBglobal e concorrência1. Downloads continuam sob demanda, custo de hash/decrypt proporcional aos bytes; primeira abertura exige arquivo verificado completo. Nenhum ganho de latência real de mídia alegado antes de teste humano.

## Rollback e limites

Rollback direcionado de imagens: Core recovery-41fdf6a (f7dc51e4...), Provider recovery-da15c3b (81fa9588...), Chat qrfix-dbab1ae (974da16b...). Compatíveis com schema12 e Vault v1 atual; preservar novos dados/referências, volumes, chaves e sessão. Não restaurar DB/Signal sobre sessão ativa nem apagar filas/cache por conveniência. Tags e IDs completos constam nos artefatos runtime-before/images/deploy.

As16 antigas sem referência não são critério obrigatório e não podem ser reconstruídas só com metadata. Referências válidas antigas continuam suportadas. Histórico/dedup/envio não são usados para recuperar arquivos. Codec/navegador e disponibilidade no WhatsApp podem limitar reprodução; erros seguros/download permanecem. Emoji picker é melhoria independente, fora desta entrega.

## Homologação humana pendente

No notebook Firefox/Chrome/móvel: receber novas imagem/voz/áudio/vídeo em conversa controlada; abrir sob demanda, ampliar imagem e reproduzir/pausar/seek/volume/velocidade. Conferir carregamento, codecs, download e legendas; verificar Range em Network e ausência de credenciais na URL. Trocar Organization/sair durante carregamento; confirmar isolamento. Usuário inicia qualquer envio real. Não considerar jsdom/smoke sintético homologação visual.


## Publicação comprovada / etapa 6–7

[Core PR38](https://github.com/uillaneduardo/wapphub-core/pull/38) integra recuperação/assinatura (ca2a05f79bbe9df61595c0e5bed693c3911e5a14). [Core PR39](https://github.com/uillaneduardo/wapphub-core/pull/39) e [Chat PR28](https://github.com/uillaneduardo/wapphub-chat/pull/28) merged após revisão e CI verdes; commits funcionais Core de686ac/e1fa3c8, Chat c8d712c. Runtime é dos merges Core763981a9feb9721e63fb5aaaa0932402834aaa82 / Chatbaaee362cc160d83762c9e5f0769d62b4e62ef60; documentos posteriores não exigem rebuild.

| Serviço | Tag imutável local | Image ID |
| --- | --- | --- |
| core | wapphub-core:media-p1-763981a9feb9 | sha256:761b7bc804bcd8a30c5a647e9d4dd435a0fd76961be2171d07dbb9e61f24df66 |
| provider | wapphub-provider-web:media-p1-763981a9feb9 | sha256:5388a44cefcd4ec25160ef72ec516d1146172c559d7ee5308811bf564ecea616 |
| chat | wapphub-chat:media-p1-baaee362cc16 | sha256:262586d3d0bb48195ec4fee6b62a147d2a4991b56dda2366018e9ef88e2d55bd |

CoreAPI/Worker/Provider/Chat atualizados, seis serviços essenciais healthy. MariaDB/Redis e38containers alheios (36rodando/2parados) com IDs/imagens/StartedAt preservados. Env, flags, mounts, redes, portas, limites e restart policy preservados. Auth identity/noiseKey/identityKey/advSecret/registration e credenciais aposentadas iguais; QR ativo2→2, attempts17→18 por restart autorizado. Conta antiga continua DISCONNECTED sem ação. Organization/User/Membership/RBAC hashes preservados; schema12/checksums iguais, nenhum dado excluído. Filas pending/dead/syncDead/syncQueued/outbound0, ativo failures0; limites/rejeições históricos de diagnóstico não foram apagados.

API health/readiness local e público200; Chat público200 e2assets servidos iguais ao container. CORS público OPTIONS204 da origem chat.wapphub.com.br com credentials/Range; Core expõe Content-Range. Guard401/403/404 eRange200/206/416 comprovados também em smoke da imagem final com banco isolado, sem criar sessões produtivas. Providerreadytrue e login/autenticação/reconexão preservados; nenhum erro crítico novo. GET HMAC produtivo de cache existente200/imagepng/3211bytes/SHA válido, headers348,61ms/completo352,49ms. Mídia antiga sem referência mantém404MEDIA_UNAVAILABLE (agora não503opaco).

Smokes da imagem final:8referências sintéticas/query+URL-only deIMAGE/AUDIO/VOICE/VIDEO retidas → SDKreal/descriptografia → cacheAES → HTTPHMAC → clienteCore, bytes/MIME/tamanho/SHA corretos,8downloads/8cachehits/0.parts. Retenção1,27–5,87ms; headers13,33–118,21ms, cache6,37–12,80ms (arquivos pequenos, rede remota mock, networknone; não é latência real do WhatsApp). Runtime também verifica codecs/conversãoWebM e envio mock5vezes/0real. CoreRuntime auth/tenant/RBAC/ranges emDBtest; nenhum acesso de teste com mutação ao DBprod.

Gates: Core154/154,Provider150/150,Chat346/346; lint/typecheck/build de todos, Prisma/status/drift/OpenAPI e auditSDK aprovados. [Core CI86](https://github.com/uillaneduardo/wapphub-core/actions/runs/38454225584), [Provider CI82](https://github.com/uillaneduardo/wapphub-core/actions/runs/38454225532), [Chat CI50](https://github.com/uillaneduardo/wapphub-chat/actions/runs/38454229130). Execução paralela inicial no homelab teve timeout em teste existenteAppShell; repetição com2workers/arquivossequenciais e CI limpo aprovaram toda suite, sem alterar autenticação. Ajustes de fixtures de smoke (limite do códigoRole e404de ocultação tenant) corrigidos antes do deploy. Nenhum teste falhando aceito.

Backup consistente preservado em /home/uillan/homelab/backups/wapphub-core/pre-media-p1-20261013-190028; SQL/Vault/configs commanifestSHA/gzip e restauração isolada verificados. Rollback preparado em release.py rollback --execute (imagens anteriores somente, sem DB/Signalrestore), não executado por ausência de regressão. Comandos/overrides privados e IDs de rollback nos artefatos. Rollback exige avaliar compatibilidade se o schema/Vault mudar numa entrega futura.

Novas referências em produção ainda dependem da próxima mídia recebida legitimamente. As16antigas4IMAGE/12VOICE mantêm0referências; nenhuma exclusão/importação/QR para reconstruí-las. Homologação humana de reprodução, codec, seek/cookies emFirefox/Chrome/móvel e tempos WhatsApp→Chat permanece pendente. Conferir mídia nova, não usar as16antigas como critério. Emoji picker independente.
