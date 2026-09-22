import { NextRequest } from "next/server";
import { requireCondition } from "./config";
export async function boundedBody(req: NextRequest, limit = 65536) {
  requireCondition(
    Number(req.headers.get("content-length") || 0) <= limit,
    413,
    "BODY_TOO_LARGE",
  );
  const reader = req.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > limit) {
      reader.releaseLock();
      requireCondition(false, 413, "BODY_TOO_LARGE");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}
