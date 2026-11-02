import { ensureUserInTrip, loadBlogVisibilityContext, persistBlogVisibility, setTripTimezone, writeBlogEarlyRelease, writeBlogPrivacyChoice } from '../db';
import { type BlogPrivacyChoice, type BlogVisibilityContext, type BlogVisibilityResult } from '../blog/visibilityTypes';
import { isFeatureEnabled } from './entitlementService';
import { validTimezone } from './notificationTiming';
import { timezoneForCoordinates } from './tripTimezoneService';

const localDay = (now: Date, timezone: string): string => {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now).map(p => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
};

/** Pure policy; never consults publication epochs, photo alt text, or consent requests. */
export const evaluateBlogVisibilityContext = (context: BlogVisibilityContext, now: Date, sharingEnabled = true): BlogVisibilityResult => {
  const timezone = context.timezone && validTimezone(context.timezone) ? context.timezone : 'UTC';
  const today = localDay(now, timezone);
  const reasons: BlogVisibilityResult['reasons'] = [];
  if (!sharingEnabled) reasons.push('SHARING_DISABLED');
  const tripStarted = Boolean(context.startDate && today >= context.startDate);
  if (!context.earlyRelease && !tripStarted) reasons.push(context.startDate ? 'TRIP_NOT_STARTED' : 'START_DATE_NOT_SET');
  let missingBirthDate = 0, underAge = 0;
  for (const member of context.members) {
    if (!member.dateOfBirth || member.dateOfBirth > today) { missingBirthDate += 1; continue; }
    const age = Number(today.slice(0, 4)) - Number(member.dateOfBirth.slice(0, 4)) - (today.slice(5) < member.dateOfBirth.slice(5) ? 1 : 0);
    if (age < 16) underAge += 1;
  }
  if (missingBirthDate) reasons.push('ACCOUNT_AGE_UNKNOWN');
  if (underAge) reasons.push('ACCOUNT_UNDER_16');
  const optedOutTravelers = context.members.filter(m => m.optOut || (!m.publicByDefault && !m.optIn)).map(m => ({ userId: m.userId, firstName: m.firstName }));
  if (optedOutTravelers.length) reasons.push('TRAVELER_OPT_OUT');
  return { isPublic: reasons.length === 0, reasons, goesPublicOn: !tripStarted && !context.earlyRelease ? context.startDate : null,
    startDate: context.startDate, localDate: today, timezone, tripStarted, earlyRelease: context.earlyRelease, missingBirthDate, underAge, optedOutTravelers };
};

export const evaluateBlogVisibility = async (tripId: string, now = new Date()): Promise<BlogVisibilityResult> => {
  const context = await loadBlogVisibilityContext(tripId);
  if (!context) throw new Error('Trip not found');
  if (!context.timezone || !validTimezone(context.timezone)) {
    context.timezone = (context.destination && timezoneForCoordinates(context.destination.lat, context.destination.lng))
      || (context.organizerTimezone && validTimezone(context.organizerTimezone) ? context.organizerTimezone : 'UTC');
    await setTripTimezone(tripId, context.timezone);
  }
  return evaluateBlogVisibilityContext(context, now, await isFeatureEnabled('trip_blog_public_sharing'));
};

export const synchronizeBlogVisibility = async (tripId: string, now = new Date()): Promise<boolean> => {
  const result = await evaluateBlogVisibility(tripId, now);
  const context = await loadBlogVisibilityContext(tripId);
  if (!context?.members.length) return false;
  return persistBlogVisibility(tripId, result, context.members[0].userId, now.toISOString());
};

export class BlogVisibilityError extends Error {
  constructor(message: string, public readonly status: number, public readonly code: string) { super(message); }
}

export const changeBlogPrivacy = async (tripId: string, actorUserId: string, choice: BlogPrivacyChoice): Promise<BlogVisibilityResult> => {
  if (!(await ensureUserInTrip(tripId, actorUserId))) throw new BlogVisibilityError('Not authorized', 403, 'TRIP_FORBIDDEN');
  // The actor is taken only from the authenticated session. No request may target another user.
  await writeBlogPrivacyChoice(tripId, actorUserId, choice);
  await synchronizeBlogVisibility(tripId);
  return evaluateBlogVisibility(tripId);
};

export const releaseBlogEarly = async (tripId: string, actorUserId: string): Promise<BlogVisibilityResult> => {
  if (!(await ensureUserInTrip(tripId, actorUserId))) throw new BlogVisibilityError('Not authorized', 403, 'TRIP_FORBIDDEN');
  const result = await evaluateBlogVisibility(tripId);
  if (result.reasons.some(r => !['TRIP_NOT_STARTED', 'START_DATE_NOT_SET'].includes(r))) {
    throw new BlogVisibilityError('Public viewing requires all account travelers to be 16 or older and no active opt-outs.', 409, 'BLOG_NOT_ELIGIBLE');
  }
  // Ensure the masthead exists before setting its additive early-release flag.
  await synchronizeBlogVisibility(tripId);
  await writeBlogEarlyRelease(tripId);
  await synchronizeBlogVisibility(tripId);
  return evaluateBlogVisibility(tripId);
};
