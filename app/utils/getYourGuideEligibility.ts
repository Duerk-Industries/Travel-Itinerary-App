// App facade for the shared domain contract. Keep UI callers on this path so
// the package can evolve without duplicating affiliate rules in components.
export * from '../../packages/domain/src/getYourGuideEligibility';
