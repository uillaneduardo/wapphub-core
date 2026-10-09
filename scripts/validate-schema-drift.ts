import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
// Read-only comparison. This diff is NEVER executed as SQL.
// Established against the homologated M1 schema/database before M2.1.
const expected = readFileSync(new URL("./expected-m1-foreign-key-names.txt", import.meta.url), "utf8");
const result = spawnSync("node_modules/.bin/prisma", ["migrate", "diff", "--from-schema-datasource", "prisma/schema.prisma", "--to-schema-datamodel", "prisma/schema.prisma", "--script"], { encoding: "utf8" });
if (result.status !== 0) throw new Error("Schema introspection failed");
assert.equal(result.stdout, expected, "Unexpected schema drift beyond the documented M1 FK names");
console.log("Zero new schema drift; five preexisting M1 foreign-key naming differences unchanged. No SQL executed.");
