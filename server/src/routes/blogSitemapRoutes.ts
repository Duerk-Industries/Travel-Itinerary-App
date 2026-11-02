import { evaluateBlogVisibility } from '../services/blogVisibilityService';
import { Router } from 'express';
import { isFeatureEnabled } from '../services/entitlementService';
import { queryBlog } from '../db.postgres';
import { getCurrentDbProvider } from '../db';
import { listPublicBlogSitemapFirebase } from '../blog/firebasePublicationRepository';

const router = Router();
router.get('/sitemap-trip-blogs.xml', async (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!(await isFeatureEnabled('trip_blog_public_indexing'))) return res.type('application/xml').send('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"/>');
  const rows = getCurrentDbProvider() === 'firebase'
    ? { rows: await listPublicBlogSitemapFirebase() }
    : await queryBlog<{ trip_id: string; username_slug: string; trip_slug: string; updated_at: string }>(`SELECT a.trip_id, a.username_slug, a.trip_slug, b.updated_at FROM blog_public_aliases a JOIN trip_blogs b ON b.trip_id = a.trip_id JOIN blog_publication_epochs e ON e.trip_id = a.trip_id AND e.state = 'public' WHERE a.canonical = TRUE AND b.indexing_enabled = TRUE`);
  const visible = [];
  for (const row of rows.rows) {
    const tripId = 'trip_id' in row ? String(row.trip_id) : null;
    if (!tripId || (await evaluateBlogVisibility(tripId)).isPublic) visible.push(row);
  }
  const urls = visible.map((row) => `<url><loc>https://wanderbunnies.com/${row.username_slug}/${row.trip_slug}</loc><lastmod>${new Date(row.updated_at).toISOString()}</lastmod></url>`).join('');
  res.type('application/xml').send(`<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`);
});
export default router;
