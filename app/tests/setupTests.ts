const originalError = console.error.bind(console);

console.error = (...args: unknown[]) => {
  const first = args[0];
  if (
    typeof first === 'string' &&
    first.includes('react-test-renderer is deprecated')
  ) {
    return;
  }
  originalError(...args);
};
