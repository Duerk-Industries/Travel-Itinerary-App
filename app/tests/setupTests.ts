const originalError = console.error.bind(console);

if (!(global as any).fetch) {
  (global as any).fetch = jest.fn();
}

console.error = (...args: unknown[]) => {
  const first = args[0];
  if (
    typeof first === 'string' &&
    (first.includes('react-test-renderer is deprecated') ||
      first.includes('not wrapped in act') ||
      first.includes('not wrapped in act(...)') ||
      // Many suites stub react-native components as plain strings
      // (`Text: 'Text'`), which React-DOM flags as mis-cased HTML tags.
      first.includes('is using incorrect casing'))
  ) {
    return;
  }
  originalError(...args);
};
