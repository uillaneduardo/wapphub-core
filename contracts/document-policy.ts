/** G.2 document admission policy. No runtime capability is enabled by this module. */
export const DOCUMENT_LIMIT = 16 * 1024 * 1024;
export const DOCUMENT_MIMES = {
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  csv: "text/csv",
  txt: "text/plain",
} as const;
export type DocumentExtension = keyof typeof DOCUMENT_MIMES;
const header = (value: Uint8Array, bytes: readonly number[]) => bytes.every((byte, i) => value[i] === byte);
const zip = [0x50, 0x4b, 0x03, 0x04] as const;
const ole = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1] as const;
export type DocumentAdmission = { ok: true; extension: DocumentExtension; mimeType: string } | { ok: false; code: "DOCUMENT_UNSUPPORTED" | "DOCUMENT_INVALID_NAME" | "DOCUMENT_TOO_LARGE" | "DOCUMENT_TYPE_MISMATCH" | "DOCUMENT_NEEDS_CONTAINER_INSPECTION" };
/**
 * First-pass validation; ZIP (OOXML) and OLE require trusted container parsing
 * before accepting payloads. This function intentionally NEVER accepts them.
 * Caller must also verify total byte count, stream hash, tenant and authorization.
 */
export function inspectDocument(name: string, mime: string, prefix: Uint8Array, size: number): DocumentAdmission {
    if (!name || name.length > 200 || /[\\/]/u.test(name) || [...name].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) || name.endsWith(".") || name.startsWith(".")) return { ok: false, code: "DOCUMENT_INVALID_NAME" };
  if (!Number.isSafeInteger(size) || size < 1 || size > DOCUMENT_LIMIT) return { ok: false, code: "DOCUMENT_TOO_LARGE" };
  const ext = name.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase() as DocumentExtension | undefined;
  if (!ext || !(ext in DOCUMENT_MIMES)) return { ok: false, code: "DOCUMENT_UNSUPPORTED" };
  if (DOCUMENT_MIMES[ext] !== mime) return { ok: false, code: "DOCUMENT_TYPE_MISMATCH" };
  if (ext === "pdf") return header(prefix, [0x25, 0x50, 0x44, 0x46, 0x2d]) ? { ok: true, extension: ext, mimeType: mime } : { ok: false, code: "DOCUMENT_TYPE_MISMATCH" };
  if (ext === "doc" || ext === "xls") return header(prefix, ole) ? { ok: true, extension: ext, mimeType: mime } : { ok: false, code: "DOCUMENT_TYPE_MISMATCH" };
  if (ext === "docx" || ext === "xlsx") return header(prefix, zip) ? { ok: true, extension: ext, mimeType: mime } : { ok: false, code: "DOCUMENT_TYPE_MISMATCH" };
  // Text bytes are also checked at rest before being served to the browser as attachment.
  return prefix.includes(0) ? { ok: false, code: "DOCUMENT_TYPE_MISMATCH" } : { ok: true, extension: ext, mimeType: mime };
}
