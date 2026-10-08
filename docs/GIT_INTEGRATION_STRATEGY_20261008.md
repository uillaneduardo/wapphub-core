# Integração Git proposta — Core

Inventário: `GIT_PRODUCTION_INVENTORY_20261008.md`. main e origin/main=fa292c4;
produção=72d05aa. Os commits 81a8103 (Demo) e 72d05aa (hardening) estão publicados
mas não alcançáveis por nenhum remoto. Não presumir main=produção.

1. Depois de autorização específica, enviar feat/m1-demo-provider sem force push;
   abrir PR com os dois commits sobre main/fa292c4. Revisar 56 testes/contratos,
   SQLs aditivos já aplicados e compatibilidade. Preferir merge commit para
   preservar SHAs implantados. Não aplicar migrations por integrar Git.
2. Corrigir A1 (prévia/permissions/histórico) em PR próprio com testes negativos
   sobre a linha Demo; em paralelo lógico, Chat precisa corrigir A2/realtime.
   Nesta execução só foram documentados. Novos deploys exigem autorização separada.
3. Reconciliar PR draft #7 (docs/reconcile-m1-production-20261008) com os docs
   auditados após a integração funcional. Seus b8be3e3/d411eba foram preservados
   no remoto e sua nota incorporada integralmente com complemento local. Revisar
   conflitos STATUS, não aplicar estado antigo por cima do novo. Atualizar #7 ou
   criar PR documental substituto com referência; não fechar/mesclar automaticamente.
4. Branch docs/m1-audit-m2-preparation-20261008 parte de 72d05aa; seus novos
   commits são exclusivamente Markdown, mas um PR direto sobre main antiga
   também traria código Demo. Usar base funcional ou aguardar integração antes
   de abrir revisão documental. Não apresentar diff amplo como “só docs”.
5. chore/admin-bootstrap-cli / 15dab11 é divergência local separada: provisionador
   add-demo-members não publicado/não ancestral da produção. Revisar finalidade,
   segurança e futura SeatPolicy; não incluir automaticamente nem descartá-lo.
6. Preservar todas as branches até ancestry e refs remotas confirmarem os commits.
   M2 começa de main reconciliada com correções/aceite M1, não da main antiga.

Chat deve integrar cinco pares publicados em PRs empilhados pequenos (Demo UI,
polish, scroll/composer, polish3, Lucide), preservando commits/merge commits;
ver documento homônimo em wapphub-chat. Dependência primeiro Demo Core, depois
Demo UI. Git merge não é autorização de deploy. Se aparecer automação de deploy
externa, investigar antes de integrar; não há .github/workflows versionados nos
dois repos, mas automação fora do repo não foi auditada.

Antes de envio/merge futuro: fetch, status, bases, diffs, testes negativos de
correções e checks completos em ambiente isolado; revisão humana; OpenAPI coerente.
Sem reset/clean/force push, rebase de história publicada, exclusão de branches,
reaplicação/edição de migrations ou rollback de Core para versão pré-Demo.
Push, novos PRs, merge e qualquer publicação não foram executados e dependem de
autorização posterior. M1 pode operar enquanto isso, mas não é formalmente fechado.
