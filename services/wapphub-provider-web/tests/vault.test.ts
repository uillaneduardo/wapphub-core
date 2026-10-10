import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { encryptedAuth } from "../src/baileys.js";
import { Vault } from "../src/vault.js";
import { fixture } from "./helpers.js";

test("encrypted records restore exact content and have restrictive permissions", async (t) => {
  const f = await fixture(t);
  await f.vault.update(f.scope, (record) => { record.auth = "SENSITIVE_TEST_CREDENTIAL"; });
  const files = await readdir(f.vault.directory), path = join(f.vault.directory, files[0]!);
  assert.equal((await readFile(path)).includes(Buffer.from("SENSITIVE_TEST_CREDENTIAL")), false);
  assert.equal((await stat(path)).mode & 0o777, 0o600);
  const restored = new Vault(f.vault.directory, f.key); await restored.initialize();
  assert.equal(restored.get(f.scope)?.auth, "SENSITIVE_TEST_CREDENTIAL");
  assert.equal(restored.get(f.other), undefined);
});
test("wrong key and tampered ciphertext fail closed without secrets", async (t) => {
  const f = await fixture(t); await f.sessions.create(f.scope);
  await assert.rejects(new Vault(f.vault.directory, randomBytes(32)).initialize(), /VAULT_INTEGRITY_FAILED/);
  const [file] = await readdir(f.vault.directory), path = join(f.vault.directory, file!);
  const raw = await readFile(path); raw[raw.length - 1] = raw[raw.length - 1]! ^ 1; await writeFile(path, raw);
  await assert.rejects(new Vault(f.vault.directory, f.key).initialize(), /VAULT_INTEGRITY_FAILED/);
});
test("concurrent writes serialize and aborted mutations preserve committed state", async (t) => {
  const f = await fixture(t);
  await Promise.all(Array.from({ length: 30 }, () => f.vault.update(f.scope, (record) => { record.revision++; })));
  assert.equal(f.vault.get(f.scope)?.revision, 30);
  await assert.rejects(f.vault.update(f.scope, (record) => { record.revision++; throw new Error("abort"); }));
  assert.equal(f.vault.get(f.scope)?.revision, 30);
  await f.vault.update(f.scope, (record) => { record.revision++; });
  assert.equal(f.vault.get(f.scope)?.revision, 31);
});
test("Baileys credential and signal keys survive encrypted restoration without a socket", async (t) => {
  const f = await fixture(t);
  const first = await encryptedAuth(f.vault, f.scope);
  await first.state.keys.set({ session: { "test-only-key": Buffer.from("synthetic-signal-key") } });
  const restored = new Vault(f.vault.directory, f.key); await restored.initialize();
  const second = await encryptedAuth(restored, f.scope);
  assert.deepEqual(second.state.creds.noiseKey, first.state.creds.noiseKey);
  const values = await second.state.keys.get("session", ["test-only-key"]);
  assert.equal(Buffer.from(values["test-only-key"]!).toString(), "synthetic-signal-key");
  await second.state.keys.set({ session: { "test-only-key": null } });
  assert.equal((await second.state.keys.get("session", ["test-only-key"]))["test-only-key"], undefined);
  assert.equal(f.stats().starts, 0);
});
test("disabled SDK callbacks cannot resurrect revoked authentication", async (t) => {
  const f = await fixture(t); const auth = await encryptedAuth(f.vault, f.scope);
  auth.disable(); await f.vault.update(f.scope, (record) => { delete record.auth; record.keys = {}; });
  await auth.saveCreds(); await auth.state.keys.set({ session: { stale: Buffer.from("stale") } });
  assert.equal(f.vault.get(f.scope)?.auth, undefined); assert.deepEqual(f.vault.get(f.scope)?.keys, {});
});
test("a copied encrypted record cannot impersonate another scope", async (t) => {
  const f = await fixture(t); await f.sessions.create(f.scope); await f.sessions.create(f.other);
  const files = await readdir(f.vault.directory); assert.equal(files.length, 2);
  await writeFile(join(f.vault.directory, files[1]!), await readFile(join(f.vault.directory, files[0]!)));
  await assert.rejects(new Vault(f.vault.directory, f.key).initialize(), /VAULT_INTEGRITY_FAILED/);
});
test("graceful close flushes credential updates already queued before shutdown", async (t) => {
  const f = await fixture(t); const auth = await encryptedAuth(f.vault, f.scope);
  auth.state.creds.registered = true;
  const pending = auth.saveCreds(); auth.disable(); await pending; await f.vault.flush();
  const vault = new Vault(f.vault.directory, f.key); await vault.initialize();
  assert.equal((await encryptedAuth(vault, f.scope)).state.creds.registered, true);
});
test("revocation stays effective after subsequent close and cannot revive queued credentials", async (t) => {
  const f = await fixture(t); const auth = await encryptedAuth(f.vault, f.scope);
  auth.state.creds.registered = true; const pending = auth.saveCreds();
  auth.disable(true); auth.disable(); await f.vault.update(f.scope, (record) => { delete record.auth; record.keys = {}; }); await pending;
  assert.equal(f.vault.get(f.scope)?.auth, undefined);
});
