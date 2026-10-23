import assert from "node:assert/strict";
import { test } from "node:test";
import { inspectDocumentBytes } from "../src/document-inspection.js";
import { DOCUMENT_MIMES } from "../../../contracts/document-policy.js";
const inspect = (data: Buffer, name: string, mime: string) => inspectDocumentBytes([data], name, mime, data.length);
function archive(paths: string[]) {
  const local: Buffer[] = [], central: Buffer[] = []; let cursor = 0;
  for (const name of paths) {
    const nameBytes = Buffer.from(name);
    const header = Buffer.alloc(30); header.writeUInt32LE(0x04034b50, 0); header.writeUInt16LE(20, 4); header.writeUInt16LE(0, 8); header.writeUInt16LE(nameBytes.length, 26);
    const entry = Buffer.concat([header, nameBytes]); local.push(entry);
    const record = Buffer.alloc(46); record.writeUInt32LE(0x02014b50, 0); record.writeUInt16LE(20, 4); record.writeUInt16LE(20, 6); record.writeUInt16LE(nameBytes.length, 28); record.writeUInt32LE(cursor, 42);
    central.push(Buffer.concat([record, nameBytes])); cursor += entry.length;
  }
  const cd = Buffer.concat(central), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(paths.length, 8); end.writeUInt16LE(paths.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(cursor, 16);
  return Buffer.concat([...local, cd, end]);
}
test("G.2 accepts structural OOXML DOCX and XLSX", async () => {
  await inspect(archive(["[Content_Types].xml", "word/document.xml"]), "report.docx", DOCUMENT_MIMES.docx);
  await inspect(archive(["[Content_Types].xml", "xl/workbook.xml"]), "report.xlsx", DOCUMENT_MIMES.xlsx);
});
test("G.2 rejects renamed ZIPs, unsafe paths and macro payloads", async () => {
  await assert.rejects(inspect(archive(["photo.jpg", "readme.txt"]), "fraud.docx", DOCUMENT_MIMES.docx));
  await assert.rejects(inspect(archive(["[Content_Types].xml", "../word/document.xml"]), "fraud.docx", DOCUMENT_MIMES.docx));
  await assert.rejects(inspect(archive(["[Content_Types].xml", "word/document.xml", "word/vbaProject.bin"]), "fraud.docx", DOCUMENT_MIMES.docx));
  await assert.rejects(inspect(archive(["[Content_Types].xml", "xl/workbook.xml"]), "fraud.docx", DOCUMENT_MIMES.docx));
});
test("G.2 accepts UTF-8 text and CSV, rejects binaries and type spoofing", async () => {
  await inspect(Buffer.from("linha 1\\nlinha 2", "utf8"), "notes.txt", DOCUMENT_MIMES.txt);
  await inspect(Buffer.from("coluna,valor\\na,1", "utf8"), "dados.csv", DOCUMENT_MIMES.csv);
  await assert.rejects(inspect(Buffer.from([0, 255, 0]), "danger.txt", DOCUMENT_MIMES.txt));
  await assert.rejects(inspect(Buffer.from("texto"), "danger.exe", DOCUMENT_MIMES.txt));
});
test("G.2 rejects generic OLE with no WordDocument or Workbook stream", async () => {
  const ole = Buffer.alloc(512); Buffer.from("d0cf11e0a1b11ae1","hex").copy(ole);
  await assert.rejects(inspect(ole, "danger.doc", DOCUMENT_MIMES.doc));
  await assert.rejects(inspect(ole, "danger.xls", DOCUMENT_MIMES.xls));
});
