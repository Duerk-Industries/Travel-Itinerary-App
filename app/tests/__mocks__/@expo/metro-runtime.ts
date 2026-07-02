// No-op mock for @expo/metro-runtime in tests. The real module is a
// side-effect import that installs web-only fast-refresh hooks; tests run in
// node/jsdom where those hooks don't apply.
export {};
