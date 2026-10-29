import fs from 'node:fs';
import path from 'node:path';
import bodyParser from 'body-parser';
import { Router } from 'express';
import { authenticate, type TokenPayload } from '../auth';
import { writeAuditLog } from '../db';
import { requireAdmin } from '../middleware/requireAdmin';
import { logError } from '../logger';
import { resolveRuntimeDataPath } from '../utils/runtimeDataPath';
import { loadSeedTemplates } from '../services/tripTemplateService';
import {
  bundleJsonSchema,
  buildTemplateBundle,
  importBundle,
  listTemplatesForAdmin,
  removeImportedTemplate,
} from '../services/tripTemplateBundle';

// Admin tools for itinerary templates: download what is live, import a bundle an LLM wrote (see
// data/trip-template-authoring/INSTRUCTIONS.md), and download those instructions. Mounted ahead of the
// app-wide JSON parser because a bundle is far larger than its 100 kb limit.
const router = Router();
router.use(authenticate, requireAdmin);
router.use(bodyParser.json({ limit: '15mb' }));

const AUTHORING_DIR = (): string => resolveRuntimeDataPath('trip-template-authoring', process.env.TRIP_TEMPLATE_AUTHORING_DIR);
const authoringFile = (name: string): string | null => {
  const file = path.join(AUTHORING_DIR(), name);
  return fs.existsSync(file) ? file : null;
};

const actor = (req: any): string | null => ((req.user as TokenPayload | undefined)?.userId ?? null);

router.get('/', async (_req, res) => {
  try {
    res.json({ templates: await listTemplatesForAdmin() });
  } catch (err) {
    logError('[admin-trip-templates] list failed', err);
    res.status(500).json({ error: 'Unable to list templates.' });
  }
});

// The live templates as a bundle, ready to edit with an LLM and import again. ?ids=a,b limits it.
router.get('/export', (req, res) => {
  const ids = String(req.query.ids ?? '').split(',').map((id) => id.trim()).filter(Boolean);
  const unknown = ids.filter((id) => !loadSeedTemplates().some((template) => template.id === id));
  if (unknown.length) {
    res.status(404).json({ error: `Unknown template id: ${unknown.join(', ')}.` });
    return;
  }
  const stamp = new Date().toISOString().slice(0, 10);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="wanderbunnies-templates-${stamp}.json"`);
  res.send(JSON.stringify(buildTemplateBundle(ids), null, 2));
});

// What to give the LLM: the written instructions, a complete example bundle, and the format as JSON Schema.
router.get('/authoring/instructions', (_req, res) => {
  const file = authoringFile('INSTRUCTIONS.md');
  if (!file) { res.status(404).json({ error: 'Instructions not found.' }); return; }
  res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="wanderbunnies-itinerary-instructions.md"');
  res.send(fs.readFileSync(file, 'utf8'));
});

router.get('/authoring/example', (_req, res) => {
  const file = authoringFile('example-bundle.json');
  if (!file) { res.status(404).json({ error: 'Example not found.' }); return; }
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="wanderbunnies-itinerary-example.json"');
  res.send(fs.readFileSync(file, 'utf8'));
});

router.get('/authoring/schema', (_req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="wanderbunnies-itinerary-schema.json"');
  res.send(JSON.stringify(bundleJsonSchema(), null, 2));
});

// Body: { bundle: <the file's contents>, dryRun?: boolean }. A dry run checks and reports; otherwise the bundle is
// saved only if every part of it is acceptable. Either way the report says what is new, updated or wrong.
router.post('/import', async (req, res) => {
  const bundle = req.body?.bundle;
  const dryRun = req.body?.dryRun !== false;
  if (bundle === undefined) {
    res.status(400).json({ error: 'Send the bundle as { "bundle": { ... } }.' });
    return;
  }
  try {
    const report = await importBundle(bundle, { dryRun, importedBy: actor(req) });
    if (report.applied) {
      await writeAuditLog({
        actorUserId: actor(req),
        action: 'TRIP_TEMPLATES_IMPORTED',
        afterState: {
          templates: report.templates.filter((t) => t.status === 'new' || t.status === 'updated').map((t) => ({ id: t.id, status: t.status })),
          places: report.media.places.added + report.media.places.updated,
          destinations: report.media.destinations.added + report.media.destinations.updated,
        },
        reason: typeof req.body?.reason === 'string' ? req.body.reason.slice(0, 500) : null,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'] ?? null,
      });
    }
    res.status(report.fatal ? 400 : 200).json(report);
  } catch (err) {
    logError('[admin-trip-templates] import failed', err);
    res.status(500).json({ error: 'Unable to import the bundle.' });
  }
});

// Removes an imported template: a bundled template with the same id shows again, and a new one disappears.
router.delete('/imported/:id', async (req, res) => {
  try {
    if (!(await removeImportedTemplate(req.params.id))) {
      res.status(404).json({ error: 'That template was not imported.' });
      return;
    }
    await writeAuditLog({
      actorUserId: actor(req), action: 'TRIP_TEMPLATE_IMPORT_REMOVED', afterState: { id: req.params.id },
      reason: null, ipAddress: req.ip, userAgent: req.headers['user-agent'] ?? null,
    });
    res.status(204).end();
  } catch (err) {
    logError('[admin-trip-templates] remove failed', err);
    res.status(500).json({ error: 'Unable to remove the imported template.' });
  }
});

export default router;
