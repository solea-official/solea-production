// Run from the project root after overlaying the targeted patch.
// Only removes the exact retired files from the documented baseline.
import { readFile, unlink } from "node:fs/promises";
import { createHash } from "node:crypto";
const retired = {
  "src/server/admin-mfa.ts":
    "53e524e7e92b83ec89362597bf098f592dcce246a25522bb9e66c1086af3bb1f",
  "src/server/totp.ts":
    "a3ac8079349adefc098a546a6c5ebbed09531c32d6bc97a5dca8841a63ce8621",
};
const remove = [];
for (const [file, expected] of Object.entries(retired)) {
  let bytes;
  try {
    bytes = await readFile(file);
  } catch (error) {
    if (error.code === "ENOENT") continue;
    throw error;
  }
  if (createHash("sha256").update(bytes).digest("hex") !== expected)
    throw new Error(`Refusing to remove modified file: ${file}`);
  remove.push(file);
}
for (const file of remove) await unlink(file);
console.log(`Removed ${remove.length} retired implementation files.`);
