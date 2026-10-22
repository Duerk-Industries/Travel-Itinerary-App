export type AirportLike = { name?: string; city?: string; iata_code?: string };

export const formatAirportLabel = (airport: AirportLike): string => {
  const city = airport.city || airport.name;
  const code = airport.iata_code ? ` (${airport.iata_code})` : '';
  return `${city}${code}`;
};

/**
 * Text to show for a stored airport location. An explicit label wins; then a label remembered from an
 * airport the user picked or was offered (so one that is not in the preloaded list still shows its name);
 * then the preloaded list; finally the bare code. Free text that is not a code is shown as typed.
 */
export const airportDisplayForCode = (
  code: string | null | undefined,
  label: string | null | undefined,
  rememberedLabels: Record<string, string>,
  airports: AirportLike[],
): string => {
  if (label && label.trim().length) return label;
  const normalized = code ? code.toUpperCase() : '';
  if (!normalized) return '-';
  if (!/^[A-Z0-9]{3,4}$/.test(normalized)) return code ?? normalized;
  const remembered = rememberedLabels[normalized];
  if (remembered) return remembered;
  const match = airports.find((airport) => (airport.iata_code ?? '').toUpperCase() === normalized);
  return match ? formatAirportLabel(match) : normalized;
};
