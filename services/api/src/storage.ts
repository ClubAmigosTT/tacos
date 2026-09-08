import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

const bucket = process.env.S3_BUCKET;
const publicBase = process.env.STORAGE_BUCKET_URL?.replace(/\/$/, '');
const accessKeyId = process.env.S3_ACCESS_KEY_ID;
const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;
const client = bucket && accessKeyId && secretAccessKey
  ? new S3Client({
      region: process.env.S3_REGION ?? 'us-east-1',
      endpoint: process.env.S3_ENDPOINT || undefined,
      forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
      credentials: { accessKeyId, secretAccessKey }
    })
  : null;

const contentTypes = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp'
} as const;

export async function uploadVisitImage(input: { userId: string; base64: string; contentType: keyof typeof contentTypes }) {
  if (!client || !bucket || !publicBase) throw new Error('STORAGE_NOT_CONFIGURED');
  const bytes = Buffer.from(input.base64, 'base64');
  if (!bytes.length || bytes.length > 8 * 1024 * 1024) throw new Error('IMAGE_TOO_LARGE');
  const key = `visits/${input.userId}/${crypto.randomUUID()}.${contentTypes[input.contentType]}`;
  await client.send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: bytes,
    ContentType: input.contentType,
    CacheControl: 'public,max-age=31536000,immutable'
  }));
  return { key, url: `${publicBase}/${key}` };
}
