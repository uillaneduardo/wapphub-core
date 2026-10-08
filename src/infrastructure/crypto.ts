import {
  createHash,
  randomBytes,
  scrypt,
  timingSafeEqual,
  createCipheriv,
  createDecipheriv,
} from "node:crypto";
const derive = (password: string, salt: string) =>
  new Promise<Buffer>((resolve, reject) => {
    scrypt(
      password,
      salt,
      64,
      { N: 65536, r: 8, p: 1, maxmem: 128 * 1024 * 1024 },
      (error, key) => {
        if (error) reject(error);
        else resolve(key);
      },
    );
  });
export const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export const newToken = () => randomBytes(32).toString("base64url");
export function equalHash(value: string, hash: string) {
  return timingSafeEqual(
    Buffer.from(digest(value), "hex"),
    Buffer.from(hash, "hex"),
  );
}
export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const key = await derive(password, salt);
  return `scrypt$1$${salt}$${key.toString("hex")}`;
}
export async function verifyPassword(password: string, encoded: string) {
  const [algorithm, version, salt, key] = encoded.split("$");
  if (
    algorithm !== "scrypt" ||
    version !== "1" ||
    !salt ||
    !key ||
    !/^[a-f0-9]{128}$/.test(key)
  )
    return false;
  const derived = await derive(password, salt);
  return timingSafeEqual(derived, Buffer.from(key, "hex"));
}
export function encryptSecret(
  value: string,
  key: string,
  version: string,
  scope: string,
) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", Buffer.from(key, "hex"), iv);
  cipher.setAAD(Buffer.from(`${version}:${scope}`));
  const encrypted = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
  ]);
  return [
    version,
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    encrypted.toString("base64url"),
  ].join(".");
}
export function decryptSecret(
  encoded: string,
  keys: Record<string, string>,
  scope: string,
) {
  const [version, iv, tag, encrypted] = encoded.split(".");
  if (!version || !iv || !tag || !encrypted || !keys[version])
    throw new Error("Invalid encrypted secret");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    Buffer.from(keys[version], "hex"),
    Buffer.from(iv, "base64url"),
  );
  decipher.setAAD(Buffer.from(`${version}:${scope}`));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encrypted, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}
