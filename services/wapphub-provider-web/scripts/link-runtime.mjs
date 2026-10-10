import { symlink } from "node:fs/promises";
await symlink("../node_modules", "dist/node_modules").catch((error) => { if (error.code !== "EEXIST") throw error; });
