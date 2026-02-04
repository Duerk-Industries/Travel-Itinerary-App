const store: Record<string, string> = {};
export const getItem = jest.fn(async (key: string) => (key in store ? store[key] : null));
export const setItem = jest.fn(async (key: string, value: string) => {
  store[key] = value;
});
export const removeItem = jest.fn(async (key: string) => {
  delete store[key];
});
export const clear = jest.fn(async () => {
  Object.keys(store).forEach((k) => delete store[k]);
});

export default {
  getItem,
  setItem,
  removeItem,
  clear,
};
