import "server-only";
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

// 증빙 서류 저장소.
// - 기본(STORAGE_DRIVER 미설정): DB에 바로 저장 — 개발·소규모용
// - STORAGE_DRIVER=s3: S3 호환 저장소(AWS S3, Cloudflare R2, Supabase Storage, MinIO 등)에 저장하고 DB에는 키만 남김
//   1년 시뮬레이션 기준 치료사 3만 명 × 서류 3~4장이면 수십 GB라 운영에서는 s3 사용 권장

export const storageDriver = () => (process.env.STORAGE_DRIVER === "s3" ? "s3" : "db");

let client: S3Client | null = null;
function s3() {
  if (!client)
    client = new S3Client({
      region: process.env.S3_REGION ?? "auto",
      endpoint: process.env.S3_ENDPOINT || undefined,
      forcePathStyle: !!process.env.S3_ENDPOINT,
      credentials: { accessKeyId: process.env.S3_ACCESS_KEY_ID ?? "", secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? "" },
    });
  return client;
}
const bucket = () => process.env.S3_BUCKET ?? "";

/** 저장 후 DB에 넣을 값 ({data} 또는 {storageKey}) */
export async function putDocument(userId: string, docId: string, mime: string, body: Buffer) {
  if (storageDriver() === "db") return { data: body, storageKey: null };
  const key = `credentials/${userId}/${docId}`;
  await s3().send(new PutObjectCommand({ Bucket: bucket(), Key: key, Body: body, ContentType: mime, ServerSideEncryption: process.env.S3_SSE === "off" ? undefined : "AES256" }));
  return { data: null, storageKey: key };
}

export async function getDocument(doc: { data: Buffer | null; storageKey: string | null }) {
  if (doc.data) return new Uint8Array(doc.data);
  if (!doc.storageKey) return null;
  const r = await s3().send(new GetObjectCommand({ Bucket: bucket(), Key: doc.storageKey }));
  return r.Body ? new Uint8Array(await r.Body.transformToByteArray()) : null;
}

export async function deleteDocument(doc: { storageKey: string | null }) {
  if (doc.storageKey) await s3().send(new DeleteObjectCommand({ Bucket: bucket(), Key: doc.storageKey })).catch(() => {});
}
