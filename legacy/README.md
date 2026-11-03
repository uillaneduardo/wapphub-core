# Legacy Core — preservação (migração pendente)

Snapshot íntegro da implementação antiga preservado na branch [archive/core-legacy-2026-11-03](https://github.com/uillaneduardo/wapphub-core/tree/archive/core-legacy-2026-11-03), commit `0d4356bc3d40b18def703b55a9c46309b6027ffb`.

**Importante:** a árvore antiga ainda permanece na raiz do repositório. Este diretório é inicialmente um registro de migração, e NÃO uma cópia dos arquivos legados. Não desligar serviços antigos nem alterar workflows/deploys que dependam da raiz até concluir e validar a movimentação integral.

Plano de migração definitiva:
1. Enumerar todos os arquivos rastreados no commit de referência (incluindo dotfiles e workflows).
2. Relocar o código legado para `legacy/core-v1/` preservando estrutura e conteúdo; mover workflows antigos para arquivo desativado/documentado, pois Actions só descobre workflows na raiz.
3. Validar contagem de arquivos, hashes, imports, documentos e histórico git, sem rebase ou force-push.
4. Tornar `core-next/` a implementação principal com pipelines separados.
5. Atualizar `homelab-deploy` explicitamente e homologar sem tocar nos containers antigos até autorização.
