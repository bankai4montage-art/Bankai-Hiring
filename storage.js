/**
 * Bankai-Hiring — image storage.
 *
 * If S3-compatible credentials are configured (AWS S3, Cloudflare R2, MinIO…)
 * files go to the bucket; otherwise they are kept as BLOBs in SQLite so the
 * app keeps working with zero configuration.
 *
 *   S3_BUCKET, S3_ENDPOINT, S3_REGION, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY
 *   S3_PUBLIC_BASE_URL  (optional: public/CDN base for 302 redirects)
 *   S3_PREFIX           (optional key prefix, default "bankai-hiring")
 */
import crypto from 'node:crypto';

const CFG = {
  bucket: process.env.S3_BUCKET || '',
  endpoint: process.env.S3_ENDPOINT || '',
  region: process.env.S3_REGION || 'auto',
  key: process.env.S3_ACCESS_KEY_ID || '',
  secret: process.env.S3_SECRET_ACCESS_KEY || '',
  publicBase: (process.env.S3_PUBLIC_BASE_URL || '').replace(/\/+$/, ''),
  prefix: (process.env.S3_PREFIX || 'bankai-hiring').replace(/^\/+|\/+$/g, '')
};

export const s3Enabled = Boolean(CFG.bucket && CFG.key && CFG.secret);

let clientPromise = null;
async function client() {
  if (!clientPromise) {
    clientPromise = (async () => {
      const { S3Client } = await import('@aws-sdk/client-s3');
      return new S3Client({
        region: CFG.region,
        endpoint: CFG.endpoint || undefined,
        forcePathStyle: Boolean(CFG.endpoint), // R2/MinIO prefer path-style
        credentials: { accessKeyId: CFG.key, secretAccessKey: CFG.secret }
      });
    })();
  }
  return clientPromise;
}

/** Stable object key: bankai-hiring/<courierId>/<docId>-<suffix>.<ext> */
export function objectKey(courierId, docId, suffix, ext) {
  return `${CFG.prefix}/${courierId}/${docId}${suffix ? '-' + suffix : ''}.${ext}`;
}

export const storage = {
  mode: s3Enabled ? 's3' : 'db',
  prefix: CFG.prefix,
  publicBase: CFG.publicBase,

  /** Upload a buffer. Returns { storage, key } — `db` means “keep it in SQLite”. */
  async put(key, buffer, contentType = 'image/jpeg') {
    if (!s3Enabled) return { storage: 'db', key: null };
    const { PutObjectCommand } = await import('@aws-sdk/client-s3');
    const s3 = await client();
    await s3.send(new PutObjectCommand({
      Bucket: CFG.bucket, Key: key, Body: buffer, ContentType: contentType,
      CacheControl: 'private, max-age=31536000'
    }));
    return { storage: 's3', key };
  },

  /** Public URL when the bucket/CDN serves objects directly (optional). */
  publicUrl(key) {
    return CFG.publicBase ? `${CFG.publicBase}/${key}` : null;
  },

  /** Fetch an object as a Buffer (used when there is no public base URL). */
  async get(key) {
    const { GetObjectCommand } = await import('@aws-sdk/client-s3');
    const s3 = await client();
    const out = await s3.send(new GetObjectCommand({ Bucket: CFG.bucket, Key: key }));
    const chunks = [];
    for await (const chunk of out.Body) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks);
  },

  async del(key) {
    if (!s3Enabled || !key) return;
    try {
      const { DeleteObjectCommand } = await import('@aws-sdk/client-s3');
      const s3 = await client();
      await s3.send(new DeleteObjectCommand({ Bucket: CFG.bucket, Key: key }));
    } catch (err) {
      console.warn('storage.del failed:', err?.message || err);
    }
  },

  /** Diagnostics for /api/health */
  info() {
    return { mode: this.mode, bucket: s3Enabled ? CFG.bucket : null, prefix: CFG.prefix };
  }
};

/** Random-ish id used for object keys (documents keep their own UUID in the DB). */
export const newKeyId = () => crypto.randomUUID();
