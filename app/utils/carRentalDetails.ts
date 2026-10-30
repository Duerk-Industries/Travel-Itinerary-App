import type { CarRental } from '../tabs/carRentals';
import { formatFriendlyDate, type DetailItem } from './overviewBuilder';
import { normalizeItineraryStatus, LEGACY_ITINERARY_STATUS } from './itineraryStatus';

export const formatRentalDetails = (rental: CarRental): DetailItem[] => [
    { label: 'Status', value: normalizeItineraryStatus(rental.status, LEGACY_ITINERARY_STATUS) },
    { label: 'Pickup Location', value: rental.pickupLocation || 'N/A' },
    { label: 'Pickup Date', value: formatFriendlyDate(rental.pickupDate) || rental.pickupDate || 'N/A' },
    { label: 'Dropoff Location', value: rental.dropoffLocation || 'N/A' },
    { label: 'Dropoff Date', value: formatFriendlyDate(rental.dropoffDate) || rental.dropoffDate || 'N/A' },
    { label: 'Vendor', value: rental.vendor || 'N/A' },
    { label: 'Model', value: rental.model || 'N/A' },
    { label: 'Reference', value: rental.reference || 'N/A' },
    { label: 'Prepaid', value: rental.prepaid || 'N/A' },
    { label: 'Cost', value: rental.cost ? `$${rental.cost}` : 'N/A' },
    { label: 'Notes', value: rental.notes || 'N/A' },
  ];
