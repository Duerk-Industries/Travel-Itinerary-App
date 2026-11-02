import { canOfferPremiumTrial, nextFirstSignInDialog } from '../utils/firstSignInDialogs';

const base = { ageVerificationRequired: false, invitesLoaded: true, hasPendingInvites: false, profileSettled: true, tierKey: 'free', userRole: 'user' };

describe('first sign-in dialog order (R9)', () => {
  it('asks for the date of birth before anything else', () => {
    expect(nextFirstSignInDialog({ ...base, ageVerificationRequired: true, hasPendingInvites: true })).toBe('age');
  });

  it('shows pending invites next, ahead of the Premium offer', () => {
    expect(nextFirstSignInDialog({ ...base, hasPendingInvites: true })).toBe('invites');
  });

  it('waits for the invite check to finish before offering anything', () => {
    expect(nextFirstSignInDialog({ ...base, invitesLoaded: false })).toBeNull();
  });

  it('offers Premium last, to a free account whose tier is known', () => {
    expect(nextFirstSignInDialog(base)).toBe('premium');
  });

  it('never offers Premium to an invited Pro account, so its first sign-in is date of birth then the invite', () => {
    const pro = { ...base, tierKey: 'pro' };
    expect(nextFirstSignInDialog({ ...pro, ageVerificationRequired: true, hasPendingInvites: true })).toBe('age');
    expect(nextFirstSignInDialog({ ...pro, hasPendingInvites: true })).toBe('invites');
    expect(nextFirstSignInDialog(pro)).toBeNull();
  });

  it('waits for the profile before offering it, so a Pro account never sees it flash up', () => {
    expect(nextFirstSignInDialog({ ...base, profileSettled: false, tierKey: undefined })).toBeNull();
    expect(nextFirstSignInDialog({ ...base, profileSettled: true, tierKey: undefined })).toBe('premium');
  });

  it('makes no Premium offer to anyone while the master Premium flag is off', () => {
    expect(nextFirstSignInDialog({ ...base, premiumEnabled: false })).toBeNull();
    expect(nextFirstSignInDialog({ ...base, premiumEnabled: true })).toBe('premium');
    // The age and invite dialogs are not Premium surfaces and still show.
    expect(nextFirstSignInDialog({ ...base, premiumEnabled: false, hasPendingInvites: true })).toBe('invites');
  });

  it('does not offer it to Premium, Pro or admin accounts', () => {
    expect(canOfferPremiumTrial('Premium')).toBe(false);
    expect(canOfferPremiumTrial('pro')).toBe(false);
    expect(canOfferPremiumTrial('free', 'admin')).toBe(false);
    expect(canOfferPremiumTrial('free', 'user')).toBe(true);
  });
});
