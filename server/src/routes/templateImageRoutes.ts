import { Router } from 'express';
import { openTemplateImage } from '../services/templateImageMirrorService';
import { logError } from '../logger';

// Our copies of the public-domain template pictures. Public on purpose: they are public-domain files, the key is a
// hash of the Wikimedia address, and the page that shows one may be seen before sign-in. The app's <Image> cannot
// send an Authorization header on web anyway.
const router = Router();

router.get('/:key', async (req, res) => {
  const image = await openTemplateImage(req.params.key);
  if (!image) {
    res.status(404).json({ error: 'Picture not found.' });
    return;
  }
  res.setHeader('Content-Type', image.contentType);
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (image.size !== null) res.setHeader('Content-Length', String(image.size));
  image.stream.on('error', (err) => {
    logError(`[template-images] stream failed for ${req.params.key}`, err);
    res.destroy(err);
  });
  image.stream.pipe(res);
});

export default router;
