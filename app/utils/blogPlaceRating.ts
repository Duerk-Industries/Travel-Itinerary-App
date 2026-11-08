import { screenFetch as fetch } from '../cache/screenFetch';
import { createIdempotencyKey } from './idempotencyKey';
import { formatStarMarks } from './votes';

const escapeHtml = (text: string): string => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export type RatedPlace = { name: string; firstDate?: string | null };

/** Why a rating cannot be saved as asked, or null. Synchronous, so a form can say so the moment Save is pressed. */
export const placeRatingProblem = (place: RatedPlace, stars: number | null, note: string): string | null => {
  if (stars === null && !note.trim()) return 'Choose a star rating or write a note first.';
  if (note.trim() && !place.firstDate) return 'This place has no date yet, so a note cannot be filed. Give it a star rating, or add the date to its activity.';
  return null;
};

/**
 * Saves a traveler's rating (1-5 stars, the same ratings the itinerary shows) and/or a one-line opinion for a place in the
 * trip blog. Stars go to the trip's activity ratings; an opinion becomes a note on the place's day. Resolves with a sentence
 * for the traveler. `ok` is false when nothing was asked for or the note has nowhere to go; a failed request throws.
 */
export const saveBlogPlaceRating = async (params: {
  backendUrl: string;
  headers: Record<string, string>;
  tripId: string;
  place: RatedPlace;
  stars: number | null;
  note: string;
}): Promise<{ ok: boolean; message: string; rated: boolean }> => {
  const { backendUrl, headers, tripId, place, stars } = params;
  const note = params.note.trim();
  const problem = placeRatingProblem(place, stars, note);
  if (problem) return { ok: false, message: problem, rated: false };
  const parts: string[] = [];
  let rated = false;
  if (stars !== null) {
    const response = await fetch(`${backendUrl}/api/trips/${tripId}/blog/places/rating`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ place: place.name, stars }) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Unable to save your rating');
    rated = data.rated > 0;
    parts.push(data.rated > 0 ? 'Your rating is saved.' : data.matched > 0 ? 'Your rating will count once the activity is marked Completed.' : 'No activity or stay is recorded for this place, so the rating was not kept.');
  }
  if (note) {
    const mark = stars !== null ? `${formatStarMarks(stars)} ` : '';
    const response = await fetch(`${backendUrl}/api/trips/${tripId}/blog/items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': createIdempotencyKey('place-note'), ...headers },
      body: JSON.stringify({ kindKey: 'core.text', dayDate: place.firstDate, body: `<p><strong>${mark}${escapeHtml(place.name)}</strong></p><p>${escapeHtml(note)}</p>`, tags: ['Place rating'] }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`${parts.join(' ')} ${data.error || 'Your note could not be saved.'}`.trim());
    parts.push(`Your note is on ${place.firstDate}.`);
  }
  return { ok: true, message: parts.join(' '), rated };
};
