const suppressConsoleForTests = () => {
  if (process.env.SHOW_TEST_LOGS === '1') return;
  if (!(console.log as any)._isMockFunction) jest.spyOn(console, 'log').mockImplementation(() => {});
  if (!(console.info as any)._isMockFunction) jest.spyOn(console, 'info').mockImplementation(() => {});
  if (!(console.warn as any)._isMockFunction) jest.spyOn(console, 'warn').mockImplementation(() => {});
  if (!(console.error as any)._isMockFunction) jest.spyOn(console, 'error').mockImplementation(() => {});
};

beforeEach(suppressConsoleForTests);
