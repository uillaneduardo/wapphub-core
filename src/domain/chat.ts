import { createHmac, timingSafeEqual } from "node:crypto";
import { AppError } from "./errors.js";
export const chatPermissions = [
  "contacts.read",
  "contacts.write",
  "conversations.read",
  "conversations.create",
  "conversations.archive",
  "conversations.assign",
  "conversations.transfer",
  "conversations.supervise",
  "messages.read",
  "messages.send",
  "notes.read",
  "notes.create",
  "tags.read",
  "tags.manage",
] as const;
export const agentPermissions = chatPermissions.filter(
  (p) => p !== "conversations.supervise" && p !== "tags.manage",
);
export function cursorEncode(key: string, scope: string, value: string) {
  const body = Buffer.from(JSON.stringify({ scope, value })).toString(
    "base64url",
  );
  return (
    body + "." + createHmac("sha256", key).update(body).digest("base64url")
  );
}
export function cursorDecode(key: string, scope: string, cursor?: string) {
  if (!cursor) return undefined;
  try {
    if (cursor.length > 1500) throw new Error();
    if (cursor.split(".").length !== 2) throw new Error();
    const [body, signature] = cursor.split(".");
    const expected = createHmac("sha256", key).update(body!).digest();
    const supplied = Buffer.from(signature!, "base64url");
    if (
      expected.length !== supplied.length ||
      !timingSafeEqual(expected, supplied)
    )
      throw new Error();
    const parsed = JSON.parse(Buffer.from(body!, "base64url").toString());
    if (parsed.scope !== scope || typeof parsed.value !== "string")
      throw new Error();
    return parsed.value as string;
  } catch {
    throw new AppError(400, "INVALID_CURSOR");
  }
}
export function decimal(value: string) {
  if (!/^(0|[1-9]\d{0,18})$/.test(value))
    throw new AppError(400, "INVALID_CURSOR");
  const parsed = BigInt(value);
  if (parsed > 9223372036854775807n) throw new AppError(400, "INVALID_CURSOR");
  return parsed;
}
