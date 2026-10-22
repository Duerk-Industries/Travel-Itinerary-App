/** Missing types are legacy flights. Everything else belongs to ground transfers. */
export function isFlightTransfer(item: { transferType?: unknown; transfer_type?: unknown }): boolean {
  return String(item.transfer_type || item.transferType || 'Flight').trim().toLowerCase() === 'flight';
}

export function transferExpenseCategory(item: { transferType?: unknown; transfer_type?: unknown }): 'Flights' | 'Ground Transfers' {
  return isFlightTransfer(item) ? 'Flights' : 'Ground Transfers';
}
