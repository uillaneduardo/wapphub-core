import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import { fixture } from "./helpers.js";

test("kernel writer lock rejects a duplicate process and releases after a crash", async (t) => {
  const f = await fixture(t), path = join(f.directory, "writer.lock");
  const child = spawn("flock", ["--no-fork", "--nonblock", "--conflict-exit-code", "73", path, process.execPath, "-e", "process.stdout.write('ready');setInterval(()=>{},1000)"]);
  t.after(() => child.kill("SIGKILL"));
  await new Promise<void>((resolve, reject) => { child.stdout.once("data", () => resolve()); child.once("error", reject); });
  await assert.rejects(promisify(execFile)("flock", ["--nonblock", "--conflict-exit-code", "73", path, "true"]), (error: unknown) => !!error && typeof error === "object" && "code" in error && error.code === 73);
  const exited = new Promise((resolve) => child.once("exit", resolve)); child.kill("SIGKILL"); await exited;
  await promisify(execFile)("flock", ["--no-fork", "--nonblock", "--conflict-exit-code", "73", path, "true"]);
});
