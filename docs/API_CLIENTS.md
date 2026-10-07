# API, Contratos e Clientes

## Princípio

O WappHub Core é a autoridade de domínio e expõe contratos consumíveis por múltiplos clientes.

Clientes previstos:
- WappHub Chat Web;
- WappHub Platform;
- futuro WappHub Chat Android nativo;
- ferramentas internas autorizadas.

Nenhuma regra essencial deve existir apenas no frontend web.

## Versionamento

API pública entre os próprios produtos deve nascer versionada:

```
/api/v1/...
```

Mudanças incompatíveis exigem estratégia explícita de versão/migração.

## OpenAPI

O Core deve manter OpenAPI como contrato REST oficial.

Objetivos:
- documentação;
- geração de tipos/clientes quando adequado;
- testes de contrato;
- reduzir divergência entre repositórios.

## Realtime

O contrato WebSocket/eventos também deve ser versionado/documentado.

Eventos não devem depender de detalhes internos de ORM.

## Bootstrap

Prever endpoint agregado para reduzir round trips dos clientes:

```
GET /api/v1/app/bootstrap
```

Pode retornar:
- User;
- Organization atual;
- Membership;
- permissions;
- entitlements;
- configurações básicas;
- resumo de canais;
- preferências visuais.

Não incluir segredos.

## Android futuro

O app Android deve consumir a mesma API de domínio do Chat Web.

Requisitos arquiteturais desde já:
- endpoints independentes de HTML;
- DTOs estáveis;
- paginação por cursor;
- uploads independentes do navegador;
- realtime documentado;
- autenticação capaz de suportar clientes nativos;
- idempotência/clientMessageId;
- tratamento consistente de offline/reconexão.

Não criar lógica exclusiva no backend "só para o navegador" se for regra de domínio.

## Compatibilidade

Web e Android podem possuir UX diferente, mas devem produzir os mesmos comandos e respeitar:
- Organization Context;
- RBAC;
- entitlements;
- capabilities;
- auditoria;
- isolamento multi-tenant.
