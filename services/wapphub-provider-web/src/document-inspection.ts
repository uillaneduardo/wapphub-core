import { TextDecoder } from "node:util";
import { inspectDocument, DOCUMENT_LIMIT, DOCUMENT_MIMES, type DocumentExtension } from "../../../contracts/document-policy.js";

/**
 * Second-pass inspection over the already bounded, encrypted private-file stream.
 * Never extract ZIP entries or execute document content. This check is not antivirus.
 */
export async function inspectDocumentBytes(source: AsyncIterable<Uint8Array>, name: string, mimeType: string, expectedSize: number): Promise<void> {
  if (!Number.isSafeInteger(expectedSize) || expectedSize < 1 || expectedSize > DOCUMENT_LIMIT) throw new Error("DOCUMENT_TYPE_MISMATCH");
  const chunks: Buffer[] = []; let size = 0;
  for await (const part of source) {
    size += part.length;
    if (size > expectedSize || size > DOCUMENT_LIMIT) throw new Error("DOCUMENT_SIZE_MISMATCH");
    chunks.push(Buffer.from(part));
  }
  if (size !== expectedSize) throw new Error("DOCUMENT_SIZE_MISMATCH");
  const bytes = Buffer.concat(chunks, size);
  const first = inspectDocument(name, mimeType, bytes.subarray(0, 64), size);
  if (!first.ok && first.code !== "DOCUMENT_NEEDS_CONTAINER_INSPECTION") throw new Error("DOCUMENT_TYPE_MISMATCH");
  const ext = name.split(".").at(-1)?.toLowerCase() as DocumentExtension | undefined;
  if (!ext || DOCUMENT_MIMES[ext] !== mimeType) throw new Error("DOCUMENT_TYPE_MISMATCH");
  if (ext === "pdf") {
    if (!first.ok) throw new Error("DOCUMENT_TYPE_MISMATCH");
  } else if (ext === "docx" || ext === "xlsx") {
    verifyOfficeArchive(bytes, ext);
  } else if (ext === "doc" || ext === "xls") {
    verifyLegacyOffice(bytes, ext);
  } else {
    verifyText(bytes);
  }
}

function verifyText(bytes: Buffer) {
  let decoded: string;
  try { decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { throw new Error("DOCUMENT_TYPE_MISMATCH"); }
  if ([...decoded].some(char => { const value = char.codePointAt(0)!; return value === 0 || value < 32 && ![9, 10, 13].includes(value) || value === 127; })) throw new Error("DOCUMENT_TYPE_MISMATCH");
}

function verifyLegacyOffice(bytes: Buffer, ext: "doc" | "xls") {
  const magic = Buffer.from("d0cf11e0a1b11ae1", "hex");
  if (bytes.length < 512 || !bytes.subarray(0, 8).equals(magic)) throw new Error("DOCUMENT_TYPE_MISMATCH");
  // Legacy compound files must contain the expected directory stream. No macro
  // streams are intentionally admitted in this MVP.
  const utf16 = (name: string) => Buffer.from(name, "utf16le");
  const expected = utf16(ext === "doc" ? "WordDocument" : "Workbook");
  if (!bytes.includes(expected) || bytes.includes(utf16("VBA")) || bytes.includes(utf16("Macros"))) throw new Error("DOCUMENT_TYPE_MISMATCH");
}

function verifyOfficeArchive(bytes: Buffer, ext: "docx" | "xlsx") {
  if (bytes.length < 22 || bytes.readUInt32LE(0) !== 0x04034b50) throw new Error("DOCUMENT_TYPE_MISMATCH");
  // End-of-central-directory must be in the final 65557 bytes.
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (bytes.readUInt32LE(i) === 0x06054b50 && i + 22 + bytes.readUInt16LE(i + 20) === bytes.length) { end = i; break; }
  }
  if (end < 0 || bytes.readUInt16LE(end + 4) || bytes.readUInt16LE(end + 6)) throw new Error("DOCUMENT_TYPE_MISMATCH");
  const count = bytes.readUInt16LE(end + 10);
  const centralSize = bytes.readUInt32LE(end + 12), centralStart = bytes.readUInt32LE(end + 16);
  if (count < 2 || count > 4096 || centralSize > 2 * 1024 * 1024 || centralStart + centralSize !== end) throw new Error("DOCUMENT_TYPE_MISMATCH");
  const names = new Set<string>(); let cursor = centralStart, sum = 0;
  const decoder = new TextDecoder("utf-8", { fatal: true });
  for (let index = 0; index < count; index++) {
    if (cursor + 46 > end || bytes.readUInt32LE(cursor) !== 0x02014b50) throw new Error("DOCUMENT_TYPE_MISMATCH");
    const flags = bytes.readUInt16LE(cursor + 8), method = bytes.readUInt16LE(cursor + 10);
    const compressed = bytes.readUInt32LE(cursor + 20), expanded = bytes.readUInt32LE(cursor + 24);
    const nameLength = bytes.readUInt16LE(cursor + 28), extra = bytes.readUInt16LE(cursor + 30), comment = bytes.readUInt16LE(cursor + 32);
    const localOffset = bytes.readUInt32LE(cursor + 42);
    const next = cursor + 46 + nameLength + extra + comment;
    if (!nameLength || next > end || flags & 1 || ![0, 8].includes(method) || localOffset + 30 > centralStart || bytes.readUInt32LE(localOffset) !== 0x04034b50) throw new Error("DOCUMENT_TYPE_MISMATCH");
    let name: string;
    try { name = decoder.decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength)); } catch { throw new Error("DOCUMENT_TYPE_MISMATCH"); }
    if (name.startsWith("/") || name.includes("\\") || name.split("/").some(segment => segment === ".." || !segment) && !name.endsWith("/") || [...name].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) || names.has(name)) throw new Error("DOCUMENT_TYPE_MISMATCH");
    if (/vbaProject\.bin|(^|\/)activeX\/|(^|\/)embeddings\/|\.exe$/i.test(name)) throw new Error("DOCUMENT_TYPE_MISMATCH");
    sum += expanded;
    if (sum > 64 * 1024 * 1024 || expanded > 32 * 1024 * 1024 || compressed === 0 && expanded > 0 || compressed > 0 && expanded / compressed > 100) throw new Error("DOCUMENT_TYPE_MISMATCH");
    names.add(name); cursor = next;
  }
  if (cursor !== end || !names.has("[Content_Types].xml") || !names.has(ext === "docx" ? "word/document.xml" : "xl/workbook.xml")) throw new Error("DOCUMENT_TYPE_MISMATCH");
}
