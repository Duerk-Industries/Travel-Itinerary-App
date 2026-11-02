// R3: a generated stop's location has to be a real place (a landmark, neighborhood or address). A draft once used the trip's
// own name ("UC Test Lisbon") as the location of every stop and lodging, which maps to nothing. This runs over generated
// items before they are saved: a location that is empty or is just the trip name is repaired from the item's own name and
// the trip's destination, so the saved row still points somewhere a map can find.

const normalize = (value: unknown): string => String(value ?? '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/** True when a location says nothing: blank, or merely the trip's name. */
export const isPlaceholderLocation = (value: unknown, tripName: unknown): boolean => {
  const location = normalize(value);
  if (!location) return true;
  const name = normalize(tripName);
  return Boolean(name) && location === name;
};

type Named = { name?: unknown };
type GeneratedItems<A, L> = { activities: A[]; lodgings: L[] };

/**
 * `destination` is the trip's destination as the traveler entered it; it is ignored when it is itself the trip name, since
 * that is the same non-place. Returns the repaired items and how many were changed.
 */
export const repairGeneratedLocations = <A extends Named & { startLocation?: unknown }, L extends Named & { address?: unknown }>(
  items: GeneratedItems<A, L>,
  context: { tripName?: string | null; destination?: string | null }
): { activities: A[]; lodgings: L[]; repaired: number } => {
  const destination = isPlaceholderLocation(context.destination, context.tripName) ? '' : String(context.destination).trim();
  let repaired = 0;
  const placeFor = (name: unknown): string => {
    const label = String(name ?? '').trim();
    if (!label) return '';
    return destination && !normalize(label).includes(normalize(destination)) ? `${label}, ${destination}` : label;
  };
  const activities = items.activities.map((activity) => {
    if (!isPlaceholderLocation(activity.startLocation, context.tripName)) return activity;
    const startLocation = placeFor(activity.name);
    if (startLocation === String(activity.startLocation ?? '')) return activity;
    repaired += 1;
    return { ...activity, startLocation };
  });
  const lodgings = items.lodgings.map((lodging) => {
    if (!isPlaceholderLocation(lodging.address, context.tripName)) return lodging;
    const address = placeFor(lodging.name);
    if (address === String(lodging.address ?? '')) return lodging;
    repaired += 1;
    return { ...lodging, address };
  });
  return { activities, lodgings, repaired };
};
