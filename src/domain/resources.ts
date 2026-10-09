export type ResourceState = "AVAILABLE" | "PLANNED" | "RESEARCH" | "UNSUPPORTED" | "DEPRECATED";
export type Resource = { code: string; module: string; name: string; description: string; availability: ResourceState; permissions: string[]; dependencies: string[]; base: boolean; entitlement: string | null; navigation: boolean };
const resource = (code: string, module: string, name: string, permissions: string[], availability: ResourceState = "AVAILABLE", navigation = false, dependencies: string[] = []): Resource => ({ code, module, name, description: availability === "AVAILABLE" ? `${name} da organização selecionada, conforme permissões efetivas e regras operacionais.` : `${name} ainda indisponível; não pode ser ativado nesta etapa.`, permissions, availability, navigation, dependencies, base: availability === "AVAILABLE", entitlement: null });
// Global, versioned in code; never writable through tenant APIs. No commercial contract yet.
export const resourceCatalog: readonly Resource[] = [
  resource("organization.context", "Preferências", "Contexto da organização", ["organization.read"]),
  resource("chat.conversations", "Atendimento", "Conversas", ["conversations.read", "conversations.create"], "AVAILABLE", true),
  resource("chat.text", "Atendimento", "Mensagens de texto", ["messages.read", "messages.send"], "AVAILABLE", false, ["chat.conversations"]),
  resource("chat.contacts", "Atendimento", "Contatos", ["contacts.read", "contacts.write"], "AVAILABLE", true),
  resource("conversation.archive", "Atendimento", "Arquivamento", ["conversations.archive"], "AVAILABLE", false, ["chat.conversations"]),
  resource("conversation.assignment", "Atendimento", "Atribuição", ["conversations.assign"], "AVAILABLE", false, ["chat.conversations"]),
  resource("conversation.transfer", "Atendimento", "Transferência", ["conversations.transfer"], "AVAILABLE", false, ["chat.conversations"]),
  resource("conversation.supervision", "Atendimento", "Supervisão", ["conversations.supervise"], "AVAILABLE", false, ["chat.conversations"]),
  resource("conversation.internal_notes", "Atendimento", "Notas internas", ["notes.read", "notes.create"], "AVAILABLE", false, ["chat.conversations"]),
  // Tags exist inside conversations; the separate catalog page remains unimplemented.
  resource("conversation.tags", "Atendimento", "Etiquetas nas conversas", ["tags.read", "tags.manage"]),
  resource("chat.files", "Atendimento", "Arquivos", [], "PLANNED"),
  resource("chat.quick_replies", "Produtividade", "Respostas rápidas", [], "PLANNED"),
  resource("chat.automations", "Produtividade", "Automações", [], "PLANNED"),
  resource("chat.bots", "Produtividade", "Bots", [], "PLANNED"),
  resource("chat.campaigns", "Comunicação", "Campanhas", [], "PLANNED"),
  resource("whatsapp.status", "Comunicação", "Status", [], "RESEARCH"),
  resource("calling.audio", "Comunicação", "Chamadas", [], "RESEARCH"),
  resource("team.permissions", "Gestão", "Equipe e permissões", ["team.read", "team.permissions.manage"], "AVAILABLE", true),
  resource("providers.management", "Gestão", "Canais e integrações", ["providers.manage"], "AVAILABLE", true),
  resource("providers.demo", "Gestão", "Simulador Demo", ["providers.simulate"], "AVAILABLE", true, ["chat.text"]),
  resource("organization.usage", "Gestão", "Uso e custos", [], "PLANNED"),
  resource("organization.subscription", "Gestão", "Plano e assinatura", [], "PLANNED"),
  resource("chat.settings", "Preferências", "Configurações", [], "PLANNED"),
];
const names: Record<string, string> = {
  "organization.read": "Acessar a organização", "contacts.read": "Consultar contatos", "contacts.write": "Criar e editar contatos",
  "conversations.read": "Consultar conversas autorizadas", "conversations.create": "Criar conversas", "conversations.archive": "Arquivar e reabrir conversas",
  "conversations.assign": "Atribuir conversas", "conversations.transfer": "Transferir conversas", "conversations.supervise": "Supervisionar conversas",
  "messages.read": "Ler mensagens autorizadas", "messages.send": "Enviar mensagens", "notes.read": "Consultar notas internas", "notes.create": "Criar notas internas",
  "tags.read": "Consultar etiquetas", "tags.manage": "Gerenciar etiquetas", "providers.manage": "Gerenciar providers", "providers.simulate": "Operar simulador Demo",
  "team.read": "Consultar equipe", "team.permissions.manage": "Gerenciar permissões da equipe",
};
export const permissionCatalog = resourceCatalog.flatMap((r) => r.permissions.map((code) => ({ code, name: names[code]!, module: r.module, resourceCode: r.code, editable: code !== "organization.read", sensitive: r.module === "Gestão" || code === "conversations.supervise" })));
export function permissionAvailable(code: string): boolean {
  return resourceCatalog.some((r) => r.permissions.includes(code) && r.availability === "AVAILABLE" && r.base && !r.entitlement && r.dependencies.every((d) => resourceCatalog.some((dependency) => dependency.code === d && dependency.availability === "AVAILABLE")));
}
export type PermissionSource = { role: { permissions: { permission: { code: string } }[] }; permissionOverrides?: { permission: { code: string }; effect: string }[] };
export function resolvePermissions(member: PermissionSource): string[] {
  const permissions = new Set(member.role.permissions.map((entry) => entry.permission.code));
  for (const override of member.permissionOverrides ?? []) if (override.effect === "GRANT") permissions.add(override.permission.code);
  for (const override of member.permissionOverrides ?? []) if (override.effect === "REVOKE") permissions.delete(override.permission.code);
  return [...permissions].filter(permissionAvailable).sort();
}

for (const item of resourceCatalog) { Object.freeze(item.permissions); Object.freeze(item.dependencies); Object.freeze(item); }
Object.freeze(resourceCatalog);
for (const item of permissionCatalog) Object.freeze(item);
Object.freeze(permissionCatalog);
