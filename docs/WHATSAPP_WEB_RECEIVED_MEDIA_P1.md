# P1 — mídias recebidas / execução da A2 aprovada

Estado: implementação e validação técnica; publicação e homologação real ainda pendentes. A autorização de 13/10 inclui commits, PRs, merge com CI/revisão aprovados e deploy; não permite envio real, logout ou novo pareamento por automação.

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
