type CarRental = {
  id: string;
  pickupLocation: string;
  pickupDate: string;
  dropoffLocation: string;
  dropoffDate: string;
  reference: string;
  vendor: string;
  prepaid: string;
  cost: string;
  model: string;
  notes: string;
  paidBy: string[];
};

const addCarRental = (list: CarRental[], draft: Omit<CarRental, 'id'>): CarRental[] => {
  const newRental: CarRental = { ...draft, id: 'test-id' };
  return [...list, newRental];
};

const removeCarRental = (list: CarRental[], id: string): CarRental[] => list.filter((r) => r.id !== id);

describe('Car Rentals', () => {
  const baseDraft: Omit<CarRental, 'id'> = {
    pickupLocation: 'Airport',
    pickupDate: '2026-01-02',
    dropoffLocation: 'Downtown',
    dropoffDate: '2026-01-05',
    reference: 'ABC123',
    vendor: 'Budget',
    prepaid: 'Yes',
    cost: '123.45',
    model: 'Peugeot 3008 automatic',
    notes: 'Test rental',
    paidBy: ['payer-1'],
  };

  it('adds a car rental to the list', () => {
    const result = addCarRental([], baseDraft);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject(baseDraft);
    expect(result[0].id).toBeTruthy();
  });

  it('removes a car rental by id', () => {
    const existing: CarRental = { ...baseDraft, id: 'keep-me' };
    const toRemove: CarRental = { ...baseDraft, id: 'remove-me', reference: 'XYZ' };
    const result = removeCarRental([existing, toRemove], 'remove-me');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('keep-me');
  });
});
