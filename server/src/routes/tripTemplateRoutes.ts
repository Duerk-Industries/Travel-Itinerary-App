import { Router } from 'express';
import bodyParser from 'body-parser';
import { authenticate, type TokenPayload } from '../auth';
import { deleteTrip } from '../db';
import { EntitlementError } from '../errors';
import { isFeatureEnabled } from '../services/entitlementService';
import { createWizardTrip, WizardTripError } from './tripRoutes';
import {
  buildTemplatePreview,
  getSeedTemplate,
  isIsoDate,
  listOfferedTemplates,
  populateTripFromTemplate,
  populateUndatedTripFromTemplate,
  resolveSelectedDestinations,
  templateDestinations,
  templateEndDate,
  templateHeroImage,
} from '../services/tripTemplateService';
import { listTripTemplates } from '../db';
import { logError, logInfo } from '../logger';

// Itinerary templates: a worked example for a destination the traveler already chose, which they
// can turn into a trip and then change like any other. Free for every tier; only the
// `trip_templates` flag (on by default) can switch it off.
const router = Router();
router.use(bodyParser.json());
router.use(authenticate);

const csv = (value: unknown): string[] =>
  String(value ?? '').split(',').map((part) => part.trim()).filter(Boolean).slice(0, 25);

router.use(async (req, res, next) => {
  const user = (req as any).user as TokenPayload;
  if (!(await isFeatureEnabled('trip_templates', user.userId, user.role))) {
    res.status(404).json({ error: 'Templates are not available.' });
    return;
  }
  next();
});

// What is on offer for the destinations the traveler picked. Nothing selected, or nothing aligned, is an empty list.
router.get('/', async (req, res) => {
  try {
    const selected = await resolveSelectedDestinations({ locationIds: csv(req.query.locationIds), countries: csv(req.query.countries), cities: csv(req.query.cities) });
    const maxDays = Number(req.query.maxDays);
    const offered = await listOfferedTemplates(selected, Number.isSafeInteger(maxDays) && maxDays > 0 ? maxDays : null);
    res.json({
      templates: offered.map((template) => ({
        id: template.id, title: template.title, summary: template.summary, days: template.days, route: template.route,
        cities: template.cities, highlights: template.highlights, imageQuery: template.imageQuery, matchedCities: template.matchedCities,
        // Our own public-domain picture when the catalogue has one; the app falls back to imageQuery otherwise.
        heroImage: (() => { const seed = getSeedTemplate(template.id); return seed ? templateHeroImage(seed) : null; })(),
      })),
    });
  } catch (err) {
    logError('[trip-templates] list failed', err);
    res.json({ templates: [] });
  }
});

// One template in full, day by day, for the preview before it is chosen.
router.get('/:id', async (req, res) => {
  const seed = getSeedTemplate(req.params.id);
  const record = (await listTripTemplates({ enabledOnly: true })).find((row) => row.id === req.params.id);
  if (!seed || !record) {
    res.status(404).json({ error: 'Template not found.' });
    return;
  }
  res.json({
    id: seed.id, title: seed.title, summary: seed.summary, days: seed.days, route: seed.route, arrive: seed.arrive, depart: seed.depart,
    cities: seed.cities, highlights: seed.highlights, imageQuery: seed.imageQuery, heroImage: templateHeroImage(seed),
    destinations: templateDestinations(seed),
    stays: seed.stays.map((stay) => ({ base: stay.base, hotel: stay.hotel, nights: stay.nights, area: stay.area })),
    preview: buildTemplatePreview(seed),
  });
});

// Creates a trip pre-filled from the template. The template fixes the length; the traveler picks the start date.
router.post('/:id/trip', async (req, res) => {
  const user = (req as any).user as TokenPayload;
  const seed = getSeedTemplate(req.params.id);
  const record = (await listTripTemplates({ enabledOnly: true })).find((row) => row.id === req.params.id);
  if (!seed || !record) {
    res.status(404).json({ error: 'Template not found.' });
    return;
  }
  // With a start date the plan is dated; with only a trip length it goes in by day number.
  const startDate = isIsoDate(req.body?.startDate) ? (req.body.startDate as string) : null;
  const durationDays = Number(req.body?.durationDays);
  if (req.body?.startDate && !startDate) {
    res.status(400).json({ error: 'The start date is not a valid date.' });
    return;
  }
  if (!startDate && !(Number.isSafeInteger(durationDays) && durationDays > 0)) {
    res.status(400).json({ error: 'Choose a start date or a trip length for this template.' });
    return;
  }
  if (!startDate && durationDays < seed.days) {
    res.status(400).json({ error: `This template is ${seed.days} days; the trip is only ${durationDays}.` });
    return;
  }
  // The trip keeps the traveler's own end date when it is later than the template's.
  const templateEnd = startDate ? templateEndDate(seed, startDate) : null;
  const requestedEnd = isIsoDate(req.body?.endDate) ? (req.body.endDate as string) : null;
  const endDate = templateEnd && requestedEnd && requestedEnd > templateEnd ? requestedEnd : templateEnd;
  let createdTripId: string | null = null;
  try {
    const created = await createWizardTrip(user, {
      ...req.body,
      name: typeof req.body?.name === 'string' && req.body.name.trim() ? req.body.name : seed.title,
      startDate,
      endDate,
      durationDays: startDate ? null : durationDays,
    }, 'template');
    createdTripId = created.trip.id;
    const counts = startDate
      ? await populateTripFromTemplate({ userId: user.userId, tripId: created.trip.id, groupId: created.groupId, template: seed, startDate, estimated: Number(req.body?.startMonth) > 0 })
      : await populateUndatedTripFromTemplate({ userId: user.userId, tripId: created.trip.id, template: seed, tripDays: durationDays });
    logInfo(`[trip-templates] created trip from ${seed.id} (${counts.lodgings} stays, ${counts.activities} activities, ${counts.transfers} transfers)`);
    res.status(201).json({ trip: created.trip, groupId: created.groupId, invites: created.invites, templateId: seed.id, counts });
  } catch (err) {
    // A half-filled trip is worse than none: take it back out so the traveler can try again.
    if (createdTripId) await deleteTrip(user.userId, createdTripId).catch((cleanupErr) => logError('[trip-templates] cleanup failed', cleanupErr));
    if (err instanceof EntitlementError) {
      res.status(402).json({ error: err.message, code: err.code });
      return;
    }
    if (err instanceof WizardTripError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    logError('[trip-templates] create failed', err);
    res.status(400).json({ error: (err as Error).message });
  }
});

export default router;
