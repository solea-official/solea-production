import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { AppError, requireCondition } from "./config";

type StorageProvider = {
  upload(bucket: string, path: string, data: Buffer, contentType: string): Promise<string>;
  remove(bucket: string, path: string): Promise<void>;
  download(bucket: string, path: string): Promise<Buffer>;
  publicUrl(bucket: string, path: string): string;
};

const globalStorage = globalThis as unknown as { soleaStorageProvider?: StorageProvider };

function configuredProvider(): StorageProvider {
  if (globalStorage.soleaStorageProvider) return globalStorage.soleaStorageProvider;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  requireCondition(url && key, 503, "STORAGE_NOT_CONFIGURED");
  const client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return {
    async upload(bucket, path, data, contentType) {
      const { error } = await client.storage.from(bucket).upload(path, data, {
        contentType,
        cacheControl: "31536000",
        upsert: false,
      });
      if (error) throw new AppError(502, "STORAGE_UPLOAD_FAILED");
      return path;
    },
    async remove(bucket, path) {
      const { error } = await client.storage.from(bucket).remove([path]);
      if (error) throw new AppError(502, "STORAGE_DELETE_FAILED");
    },
    async download(bucket, path) {
      const { data, error } = await client.storage.from(bucket).download(path);
      if (error || !data) throw new AppError(404, "FILE_NOT_FOUND");
      return Buffer.from(await data.arrayBuffer());
    },
    publicUrl(bucket, path) {
      return client.storage.from(bucket).getPublicUrl(path).data.publicUrl;
    },
  };
}

export async function normalizedImage(file: File, maxBytes = 4_000_000) {
  requireCondition(
    ["image/jpeg", "image/png", "image/webp"].includes(file.type),
    400,
    "INVALID_FILE",
  );
  requireCondition(file.size <= maxBytes, 413, "FILE_TOO_LARGE");
  try {
    const image = sharp(Buffer.from(await file.arrayBuffer()), {
      limitInputPixels: 20_000_000,
      animated: false,
    });
    const metadata = await image.metadata();
    requireCondition(
      ["jpeg", "png", "webp"].includes(metadata.format || "") &&
        (!metadata.pages || metadata.pages === 1),
      400,
      "INVALID_FILE",
    );
    return await image
      .rotate()
      .resize(1800, 1800, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: 88 })
      .toBuffer();
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(400, "INVALID_FILE");
  }
}

export async function uploadProductImage(productId: string, file: File) {
  const provider = configuredProvider();
  const bucket = process.env.SUPABASE_STORAGE_BUCKET || "product-images";
  const path = `products/${productId}/${randomUUID()}.webp`;
  await provider.upload(bucket, path, await normalizedImage(file), "image/webp");
  return { path, url: provider.publicUrl(bucket, path) };
}

export async function uploadPaymentProof(orderId: string, file: File) {
  const provider = configuredProvider();
  const bucket = process.env.SUPABASE_PAYMENT_PROOFS_BUCKET || "payment-proofs";
  const path = `orders/${orderId}/${randomUUID()}.webp`;
  await provider.upload(bucket, path, await normalizedImage(file), "image/webp");
  return path;
}

export async function removeStored(path: string, proof = false) {
  await configuredProvider().remove(
    proof
      ? process.env.SUPABASE_PAYMENT_PROOFS_BUCKET || "payment-proofs"
      : process.env.SUPABASE_STORAGE_BUCKET || "product-images",
    path,
  );
}

export async function downloadPaymentProof(path: string) {
  return configuredProvider().download(
    process.env.SUPABASE_PAYMENT_PROOFS_BUCKET || "payment-proofs",
    path,
  );
}
