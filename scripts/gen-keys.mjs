// Generates an Ed25519 key pair for JWT signing and prints env lines.
// Usage: node scripts/gen-keys.mjs           -> prints JWT_PRIVATE_KEY=... and JWT_PUBLIC_KEY=...
//        node scripts/gen-keys.mjs --write   -> appends/replaces the values in ./.env
//        node scripts/gen-keys.mjs --ci      -> same as default (for GITHUB_ENV redirection)
import { generateKeyPairSync } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const encode = (key) =>
  Buffer.from(JSON.stringify(key.export({ format: "jwk" }))).toString("base64url");
const priv = encode(privateKey);
const pub = encode(publicKey);

const lines = [`JWT_PRIVATE_KEY=${priv}`, `JWT_PUBLIC_KEY=${pub}`];

if (process.argv.includes("--write")) {
  const path = ".env";
  let content = existsSync(path) ? readFileSync(path, "utf8") : "";
  for (const line of lines) {
    const [name] = line.split("=");
    const re = new RegExp(`^${name}=.*$`, "m");
    content = re.test(content) ? content.replace(re, line) : `${content.trimEnd()}\n${line}\n`;
  }
  writeFileSync(path, content);
  process.stdout.write(`Wrote JWT keys to ${path}\n`);
} else {
  process.stdout.write(`${lines.join("\n")}\n`);
}
