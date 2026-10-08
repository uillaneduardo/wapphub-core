# Consolidação Git final M1 — wapphub-core

Consulta/fetch: 2026-10-08T21:20:07.074693+00:00. GitHub consultado pelo conector em modo GET; PR [7](https://github.com/uillaneduardo/wapphub-core/pull/7) continua aberto/draft, base main, 2 commits, 2 arquivos documentais, mergeable=true contra a main atual. É o único PR aberto retornado para este repositório.

## Fotografia anterior à auditoria

- Branch: `feat/m1-contacts-conversation-creation`, árvore limpa.
- HEAD e docs pós-deploy: `c8faef35d8b270af6f32e516e4deba91c92bc420`.
- main local: `fa292c4e0d33306253061352da43bb4c61046054`.
- origin/main após fetch: `fa292c4e0d33306253061352da43bb4c61046054`; iguais, nenhum commit main remoto faltante.
- Produção homologada: `a45fb330ceeb6a703c463174f4fa560ad070e226`; não presumir que main a contém.
- Branch preparada: `integration/m1-accepted-20261008`, criada sem cherry-pick/rebase/merge a partir do HEAD acima; alterações desta auditoria somente docs.

## Branches e ancestralidade

Contagens abaixo são antes dos commits desta auditoria. Main-only/ref-only comparam com origin/main. Incluída significa tip ancestral do HEAD homologado + docs; refs remotas disponíveis como objetos locais após fetch podem não ser ancestrais de nenhuma branch local.

| Ref | SHA completo | main-only | ref-only | Incluída |
| --- | --- | --- | --- | --- |
| `chore/admin-bootstrap-cli` | `15dab117b814cdbc7729ca550d6e64fe03defd74` | 0 | 1 | não |
| `chore/m0-cloudflare-deploy` | `9cefb7e44269ddc389e4049ed4620c65aa2f8fa3` | 10 | 0 | sim |
| `docs/m1-audit-m2-preparation-20261008` | `99ef04b03780db5b422a73de9cd9ca18bea05139` | 0 | 4 | sim |
| `docs/m1-production-validation` | `81e582d63553083e49c871a1e45576b8295ea0a7` | 3 | 0 | sim |
| `docs/p0-production-deploy-20261008` | `8a7c432aa916d6152bf0725395f4da242456eea1` | 0 | 6 | sim |
| `feat/m0-foundation` | `97a31663e9c1670ffcd27801fdd55095641311ca` | 14 | 0 | sim |
| `feat/m1-chat-internal` | `e9983b9a1ee03a1c2b0c0917e6dbed4f3ff04662` | 5 | 0 | sim |
| `feat/m1-contacts-conversation-creation` | `c8faef35d8b270af6f32e516e4deba91c92bc420` | 0 | 10 | sim |
| `feat/m1-demo-provider` | `72d05aa8c0a3c9f12a8c17abb25ad737b88c65af` | 0 | 2 | sim |
| `feat/m1-team-roster` | `b33d3bdde564c51cc6dc1f70885d88f45d67884d` | 1 | 0 | sim |
| `fix/m1-message-preview-authorization` | `cbaf50c5eedd6731e1ca3a674c1d9b0b20005a7d` | 0 | 5 | sim |
| `main` | `fa292c4e0d33306253061352da43bb4c61046054` | 0 | 0 | sim |
| `origin` | `fa292c4e0d33306253061352da43bb4c61046054` | 0 | 0 | sim |
| `origin/chore/m0-cloudflare-deploy` | `9cefb7e44269ddc389e4049ed4620c65aa2f8fa3` | 10 | 0 | sim |
| `origin/docs/m1-production-validation` | `81e582d63553083e49c871a1e45576b8295ea0a7` | 3 | 0 | sim |
| `origin/docs/reconcile-m1-production-20261008` | `d411eba85f00f0374e2831d6d571ee854dddf323` | 0 | 2 | não |
| `origin/feat/m0-foundation` | `97a31663e9c1670ffcd27801fdd55095641311ca` | 14 | 0 | sim |
| `origin/feat/m1-chat-internal` | `e9983b9a1ee03a1c2b0c0917e6dbed4f3ff04662` | 5 | 0 | sim |
| `origin/feat/m1-team-roster` | `b33d3bdde564c51cc6dc1f70885d88f45d67884d` | 1 | 0 | sim |
| `origin/main` | `fa292c4e0d33306253061352da43bb4c61046054` | 0 | 0 | sim |

## Commits locais ainda não publicados em nenhuma ref origin

- `c8faef35d8b270af6f32e516e4deba91c92bc420 docs(deploy): record M1 contacts production publication`
- `a45fb330ceeb6a703c463174f4fa560ad070e226 docs(m1): preserve isolated Core validation log`
- `54f36654dd4414f8154d93e3ad5a11fec611cae0 docs(m1): record contacts and conversation acceptance evidence`
- `e32ed65c45ec0b5bc3e5afbdccd76d533ff0c7ae feat(m1): add scoped contact search and safe conversation reuse`
- `8a7c432aa916d6152bf0725395f4da242456eea1 docs(deploy): record controlled P0 publication and safety backup`
- `cbaf50c5eedd6731e1ca3a674c1d9b0b20005a7d fix(m1): authorize message previews with shared read visibility`
- `99ef04b03780db5b422a73de9cd9ca18bea05139 docs(m2): plan incremental SaaS catalog and entitlement delivery`
- `e0ff500aef802cb066ca63f6ddc2f67cb18223a6 docs(m1): reconcile production, Git inventory and acceptance audit`
- `72d05aa8c0a3c9f12a8c17abb25ad737b88c65af fix(m1): harden demo provider operations`
- `81a810374e5e25abb01049acd739b27a434dad05 feat(m1): add isolated demo messaging provider`
- `15dab117b814cdbc7729ca550d6e64fe03defd74 chore(admin): add demo membership provisioner`

## Commits remotos sem ancestralidade em branches locais

- `d411eba85f00f0374e2831d6d571ee854dddf323 docs: sinalizar status histórico e apontar reconciliação M1`
- `b8be3e39fe795c36aaffe9d1ec30978e56e8d11a docs: registrar evidências de produção M1 e pendências antes do M2`

## Histórico de merges preservado

- `fa292c4e0d33306253061352da43bb4c61046054 Merge pull request #6 from uillaneduardo/feat/m1-team-roster`
- `b62a0fb07d47686eb107501e4351ddef1620451f Merge pull request #5 from uillaneduardo/docs/m1-production-validation`
- `89ca5d139ffd6b7e90bfe75a2c60db72621d695a Merge pull request #4 from uillaneduardo/feat/m1-chat-internal`
- `b790b6ce7ee427f931f84c5d0ac0ef1dd6d53fc5 Merge pull request #3 from uillaneduardo/chore/m0-cloudflare-deploy`
- `2c0982b66396753fcaa32dca9e8e6e308d434b85 Merge pull request #2 from uillaneduardo/feat/m0-foundation`

## Estratégia escolhida: branch consolidada com história existente (B)

A linha homologada é descendente linear da main remota (Core 10 commits, Chat 20 commits antes desta auditoria). Nenhum commit da main remota ficou de fora. Criar branch a partir do tip pós-deploy conserva commits originais e inclui docs posteriores; não copia/squasha/reordena commits. É mais seguro que vários PRs de branches históricas que sobrepõem ancestrais e exigiriam sincronização documental repetida. Revisão pode ser dividida em ranges funcionais, mantendo um PR consolidado por repo e merge commit final, somente após autorização.

Opção A histórica é possível, mas muitos tips incluem docs antigos de status e builds intermediários. Opção de cherry-pick/rebase descartada por duplicar hashes ou alterar a linha homologada. Branch consolidada não significa incorporar todas as branches locais.

Revisão Core por grupos: Demo 81a8103/72d05aa; reconciliação e planejamento documental preexistente e0ff500/99ef04b; P0 cbaf50c/8a7c432; contatos e32ed65/54f3665/a45fb33; deploy c8faef3; aceite atual. 99ef04b é plano M2 histórico, não implementação M2; preservá-lo não autoriza execução. Revisão Chat por grupos: Demo b1b4c31/2d58268; UI/scroll/preferences/Lucide até3e23452; auditoria6b30266; P0 d93efc5/6cdec16; P1 dc70f6a/cc61ef0/6bbc1c4/fb199b2; contatos be151d7/6b04e65; deploy4997d19; aceite atual.

Core `chore/admin-bootstrap-cli` / 15dab117b814cdbc7729ca550d6e64fe03defd74 é separado, não ancestral da entrega, modifica scripts/add-demo-members.ts. **Não incorporar** à branch consolidada, não executar provisionador, não apagar branch. Demais branches históricas funcionais são ancestrais e já estão preservadas. Não deletar automaticamente após futura integração.

## PR documental divergente: integração correspondente interrompida

PR #7 Core e #3 Chat têm base main e conteúdo de versões antigas. As notas remotas foram incorporadas como conteúdo com complemento local, não como commits; por isso os dois hashes de cada draft não são ancestrais da entrega. `git merge-tree --write-tree HEAD origin/docs/reconcile-m1-production-20261008` foi usado apenas para análise, sem merge/index/worktree alterados: conflitos add/add em docs/M1_PRODUCTION_RECONCILIATION_20261008.md e content em docs/STATUS.md nos dois repos. mergeable=true do GitHub refere-se à main antiga, não à entrega consolidada.

Conteúdo original preservado: nota local inclui íntegra do arquivo remoto e complemento posterior; evidência comparada por diff. Nenhuma versão mais recente foi sobrescrita. **Não integrar drafts diretamente**. Futuro tratamento precisa revisão: preferencialmente considerar os drafts substituídos pela consolidação e encerrá-los apenas com autorização; se exigida preservação de seus hashes na main, resolver merge documental em branch separada mediante autorização, conferindo o diff e preservando ambas as notas históricas. Não executar esse merge nesta tarefa.

## Sequência futura (nenhuma operação remota realizada)

1. Rever esta branch, evidências e limites; confirmar diff funcional idêntico à produção, sem provisionador ou M2 funcional.
2. Após autorização de push/PR, publicar branch nova sem force. Não publicar automaticamente branches antigas ou main local.
3. PR consolidado Core e Chat, revisão por ranges acima, validar ancestralidade; não requer novo deploy ou suites se apenas consolidação documental equivalentes. Qualquer resolução funcional nova exige validação direcionada.
4. Resolver destino dos drafts documentais sem perder conteúdo; até decisão, mantê-los abertos/draft.
5. Integração autorizada preservando todos os commits (merge commit, sem squash/rebase destrutivo). Não realizar merge nesta execução.
6. Fetch de confirmação: commits homologados devem ser ancestrais de origin/main; conferir ausência de diffs funcionais inesperados; registrar encerramento administrativo.

Antes de futuro merge, verificar automação externa: ausência de workflows versionados não prova ausência de deploy por webhook/serviço externo. Os dois SQLs Demo que aparecem no diff contra main já são históricos/aplicados; integrar Git não autoriza reaplicação de migrations.

Push, criação/edição/encerramento de PRs e merge exigem autorização posterior. Nenhuma infraestrutura, código ou banco alterado; nenhuma suite repetida. Evidência completa em evidence/M1_FINAL_20261008/git-inventory.json e github-pr.json. Inventário anterior GIT_PRODUCTION_INVENTORY_20261008.md permanece histórico.
