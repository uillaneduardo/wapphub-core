/** References stay private in the encrypted Vault. Never accept arbitrary fetch
 * origins: Baileys receives only a validated path and a fixed HTTPS host. */
export function mediaPath(directPath?: string | null, url?: string | null): string | undefined {
  const value = directPath || url;
  if (!value || value.length > 2048 || /[\s\\#]/.test(value) || [...value].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) || /%(?![a-f\d]{2})/i.test(value) || /%(?:0[0-9a-f]|1[0-9a-f]|7f|5c)/i.test(value)) return;
  try {
    const relative = value.startsWith("/");
    if (relative && value.startsWith("//")) return;
    const parsed = new URL(value, "https://mmg.whatsapp.net");
    if (parsed.origin !== "https://mmg.whatsapp.net" || parsed.username || parsed.password || parsed.hash || !relative && !value.startsWith("https://mmg.whatsapp.net/")) return;
    const path = relative ? value : value.slice("https://mmg.whatsapp.net".length);
    const pathname = path.split("?", 1)[0]!;
    // URL must not canonicalize path traversal or escape out of the fixed host.
    if (pathname.length < 2 || pathname !== parsed.pathname || /(?:^|\/)(?:\.|%2e){1,2}(?:\/|$)/i.test(pathname)) return;
    return path;
  } catch { return; }
}
