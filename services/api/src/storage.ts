import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

const bucket = process.env.S3_BUCKET;
const publicBase = process.env.STORAGE_BUCKET_URL?.replace(/\/$/, '');
const accessKeyId = process.env.S3_ACCESS_KEY_ID;
const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;
const storageRequired = process.env.NODE_ENV === 'production' && process.env.STORAGE_REQUIRED !== 'false';
if (storageRequired && (!bucket || !accessKeyId || !secretAccessKey || !publicBase)) {
  throw new Error('S3/R2 storage is required in production (S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, STORAGE_BUCKET_URL)');
}
if (storageRequired && !publicBase?.startsWith('https://')) {
  throw new Error('STORAGE_BUCKET_URL must be HTTPS in production');
}
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

type SupportedImageType = keyof typeof contentTypes;

async function uploadImage(input: { userId: string; base64: string; contentType: SupportedImageType; namespace: 'visits' | 'branch-photos' }) {
  if (!client || !bucket || !publicBase) throw new Error('STORAGE_NOT_CONFIGURED');
  const bytes = Buffer.from(input.base64, 'base64');
  if (!bytes.length || bytes.length > 8 * 1024 * 1024) throw new Error('IMAGE_TOO_LARGE');
  const isJpeg = input.contentType === 'image/jpeg' && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const isPng = input.contentType === 'image/png' && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const isWebp = input.contentType === 'image/webp' && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
  if (!isJpeg && !isPng && !isWebp) throw new Error('INVALID_IMAGE');
  const key = `${input.namespace}/${input.userId}/${crypto.randomUUID()}.${contentTypes[input.contentType]}`;
  await client.send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: bytes,
    ContentType: input.contentType,
    CacheControl: 'public,max-age=31536000,immutable'
  }));
  return { key, url: `${publicBase}/${key}` };
}

export async function uploadVisitImage(input: { userId: string; base64: string; contentType: SupportedImageType }) {
  return uploadImage({ ...input, namespace: 'visits' });
}

export async function uploadBranchPhotoImage(input: { userId: string; base64: string; contentType: SupportedImageType }) {
  return uploadImage({ ...input, namespace: 'branch-photos' });
}
