# ADR-0001 — Fronteiras administrativas do WappHub (M2)

Data: 2026-10-09
Status: APROVADO — decisão arquitetural, implementação pendente
Escopo: planejamento M2; nenhuma mudança do M1 homologado.

## Decisão

- `wapphub-chat` (`chat.wapphub.com.br`): frontend único dos contratantes, incluindo atendimento e administração contextual da Organization selecionada: usuários/convites/assentos, configurações e canais Meta, status e diagnóstico por provider/canal, assinatura, cobrança da Organization, consumo e projeções de custos.
- `wapphub-platform` (`platform.wapphub.com.br`): administração GLOBAL privilegiada da operadora SaaS, exclusivamente: organizações/clientes, catálogo de produtos/planos/features, subscriptions e overrides, receitas/faturas/inadimplência, gateways globais, monitoramento técnico consolidado e auditoria global. Não hospeda 'Minha Conta' do contratante.
- `wapphub-core` (`api.wapphub.com.br`): autoridade de domínio para identidade comum de clientes, Membership/Organization, autorização tenant-scoped, integrações, catálogo/entitlements, consumo e faturamento; NÃO conceder privilégios globais com Membership ou claims controláveis por cliente. Funções globais exigem fronteira backend privilegiada separada, cuja implementação e contrato serão detalhados antes de começar M2.
- `wapphub-account`: proposta CANCELADA, sem implantação; não criar aplicação adicional. O scaffold experimental não integra o produto.

## Identidade e autorização

Um User pode participar de múltiplas Organizations com papéis diferentes (OWNER em A, AGENT em B, SUPERVISOR em C). Organization selecionada define escopo; Subscription pertence à Organization, não ao User. Permissões efetivas devem ser verificadas pelo servidor em toda operação; papel nominal ou visibilidade de menu não é autorização. Prever permissões granulares, a serem contratualizadas: `team.manage`, `providers.manage`, `providers.diagnostics.read`, `usage.read`, `subscription.read`, `subscription.manage`, `billing.read`. Delegação operacional não implica acesso financeiro. Trocar Organization invalida caches e streams tenant-scoped.

## Integração Meta e consumo

Configuração OAuth/embedded signup, credenciais, WABA, números, webhooks operacionais e diagnósticos pertencem à área 'Canais e integrações' do Chat, executados pelo Core. Segredos nunca são expostos integralmente ao frontend. 'Uso e custos' do Chat mostra medidas por Organization/provider/WABA/número: mensagens, categorias faturáveis, armazenamento, limites, estimativas e projeções. Os valores Meta são estimativas até conciliação; registrar versão da tabela de preços e data, moeda, período e fonte, sem preços hardcoded. Não confundir WebSocket do Chat com saúde do canal Meta. Platform consulta agregados globais autorizados.

## Fronteira de segurança global

O Platform não compartilha código executável frontend, sessões administrativas, credenciais ou permissões privilegiadas com Chat. Endpoints globais precisam autenticação privilegiada distinta, MFA, políticas de acesso, auditoria imutável/externa quando aplicável, isolamento de rede e privilégios mínimos de banco. Subdomínios diferentes não são, isoladamente, fronteira de segurança; restringir cookies por host, Origin/CSRF/CORS e privilégios de serviço. Nenhuma manipulação de requisição, tenantId, membership ou registro comercial pelo contratante pode conceder acesso global. Elaborar threat model e testes negativos antes de implementar.

## Planejamento

M2: catálogo/entitlements, equipe e assentos, assinaturas tenant-scoped, gestão global separada, autorização e modelos de medição; M3: Meta, telemetria e custos por provider; M4: mídia/armazenamento; M5: painel consolidado e alertas. Gateways e inadimplência automatizada exigem escopo/milestone próprio antes de comprometer data de entrega; cobrança manual pode ser fluxo inicial auditável.

## Migração documental

Este ADR prevalece sobre referências antigas que situem 'Minha Conta' no Platform ou exijam `wapphub-account`. Atualizar os documentos legados gradualmente; até lá, este ADR é a fonte canônica desta decisão. Não alterar código, migrations, ambientes ou deployment pelo registro desta decisão.

## Escopo específico do Core

Preparar contratos separados para acesso tenant-scoped do Chat e operações globais privilegiadas; definir propriedade dos dados comerciais e mecanismo auditado de comando entre fronteiras. Não introduzir routes ou schema novos sem revisão do M2.
