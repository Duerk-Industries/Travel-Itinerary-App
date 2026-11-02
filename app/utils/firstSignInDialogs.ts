export type FirstSignInDialog = 'age' | 'invites' | 'premium';

type State = {
  ageVerificationRequired: boolean;
  invitesLoaded: boolean;
  hasPendingInvites: boolean;
  /** The account profile request has answered, so `tierKey` is as known as it will get. */
  profileSettled: boolean;
  tierKey?: string | null;
  userRole?: string | null;
};

/** A paying (or administering) account is not offered a trial of what it already has. */
export const canOfferPremiumTrial = (tierKey: string | null | undefined, userRole?: string | null): boolean =>
  userRole !== 'admin' && !['premium', 'pro'].includes(String(tierKey ?? '').toLowerCase());

/**
 * First sign-in can have three dialogs waiting. They appear one at a time, in this order: date of birth, then pending trip
 * invites, then the Premium offer (only once the account's tier is known). Returns the one to show now, or null.
 */
export const nextFirstSignInDialog = (state: State): FirstSignInDialog | null => {
  if (state.ageVerificationRequired) return 'age';
  if (!state.invitesLoaded) return null;
  if (state.hasPendingInvites) return 'invites';
  // Wait for the profile, so a Pro account never sees the offer flash up before its tier arrives.
  if (!state.profileSettled) return null;
  return canOfferPremiumTrial(state.tierKey, state.userRole) ? 'premium' : null;
};
