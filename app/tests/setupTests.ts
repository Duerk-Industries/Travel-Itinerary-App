const originalError = console.error.bind(console);

console.error = (...args: unknown[]) => {
  const first = args[0];
  if (
    typeof first === 'string' &&
    (first.includes('react-test-renderer is deprecated') ||
      first.includes('not wrapped in act') ||
      first.includes('not wrapped in act(...)'))
  ) {
    return;
  }
  originalError(...args);
};
