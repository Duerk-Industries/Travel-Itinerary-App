import { blogMediaRepository } from '../blog/repository';
import { logInfo, logError } from '../logger';
import { Storage } from '@google-cloud/storage';
import sharp from 'sharp';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

const storage = new Storage();
const QUARANTINE_BUCKET = process.env.BLOG_QUARANTINE_BUCKET || 'trip-blog-quarantine';
const SERVING_BUCKET = process.env.BLOG_SERVING_BUCKET || 'trip-blog-serving';

export const processMediaUpload = async (userId: string, assetId: string): Promise<void> => {
  logInfo(`[blog-media] processing assetId=${assetId} for userId=${userId}`);
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'blog-media-'));

  try {
    // Fetch the actual asset record first — processing must branch on the real mediaKind rather
    // than assuming every upload is a photo (video uploads cannot go through sharp, an image-only
    // library; they need the ffmpeg pipeline below).
    const asset = await blogMediaRepository().getAssetForProcessing(assetId);
    if (!asset) throw new Error(`Blog media asset not found: ${assetId}`);
    if (asset.uploaderUserId !== userId) throw new Error(`Asset ${assetId} does not belong to userId=${userId}`);

    const objectKey = asset.objectKey || `trip-blog/${userId}/${assetId}/source`;
    const localOriginal = path.join(tempDir, 'original');

    // 1. Download from quarantine
    await storage.bucket(QUARANTINE_BUCKET).file(objectKey).download({ destination: localOriginal });

    const stats = fs.statSync(localOriginal);
    logInfo(`[blog-media] downloaded original, size=${stats.size} bytes, mediaKind=${asset.mediaKind}`);

    let physicalBytes: number;
    if (asset.mediaKind === 'video') {
      // 2a. Process video with ffmpeg, per the output profile in blogVideoProcessingService (H.264/AAC, 1080p/30fps).
      const localProcessed = path.join(tempDir, 'primary.mp4');
      await processVideo(localOriginal, localProcessed);
      const processedKey = `trip-blog/${userId}/${assetId}/primary.mp4`;
      await storage.bucket(SERVING_BUCKET).upload(localProcessed, { destination: processedKey, contentType: 'video/mp4' });
      physicalBytes = fs.statSync(localProcessed).size;
    } else {
      // 2b. Process photo/panorama with sharp — normalize resolution and strip EXIF (sharp drops
      // metadata by default on re-encode except orientation, which .rotate() applies first).
      const localProcessed = path.join(tempDir, 'processed.jpg');
      const localThumbnail = path.join(tempDir, 'thumb.jpg');

      await sharp(localOriginal)
        .rotate() // uses EXIF orientation
        .resize(2048, 2048, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 85, progressive: true })
        .toFile(localProcessed);

      await sharp(localOriginal)
        .rotate()
        .resize(400, 400, { fit: 'cover' })
        .jpeg({ quality: 70 })
        .toFile(localThumbnail);

      const processedKey = `trip-blog/${userId}/${assetId}/primary.jpg`;
      const thumbKey = `trip-blog/${userId}/${assetId}/thumb.jpg`;

      await storage.bucket(SERVING_BUCKET).upload(localProcessed, { destination: processedKey, contentType: 'image/jpeg' });
      await storage.bucket(SERVING_BUCKET).upload(localThumbnail, { destination: thumbKey, contentType: 'image/jpeg' });

      physicalBytes = fs.statSync(localProcessed).size + fs.statSync(localThumbnail).size;
    }

    // 3. Finalize
    await blogMediaRepository().completeUpload(userId, assetId, physicalBytes);

    // 4. Cleanup quarantine
    await storage.bucket(QUARANTINE_BUCKET).file(objectKey).delete().catch(() => undefined);

    logInfo(`[blog-media] successfully processed assetId=${assetId}, billableBytes=${physicalBytes}`);
  } catch (err) {
    logError(`[blog-media] failed to process assetId=${assetId}`, err);
    throw err;
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
};

/** ffmpeg wrapper for video processing, matching the outputProfile in blogVideoProcessingService.ts */
async function processVideo(input: string, output: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const ff = spawn('ffmpeg', [
      '-i', input,
      '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2', // ensure even dimensions
      '-c:v', 'libx264', '-crf', '23', '-preset', 'medium',
      '-c:a', 'aac', '-b:a', '128k',
      '-movflags', '+faststart',
      '-f', 'mp4', output
    ]);
    ff.on('error', reject);
    ff.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited with code ${code}`));
    });
  });
}
