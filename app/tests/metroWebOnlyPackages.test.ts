/// <reference types="jest" />
/// <reference types="node" />
/**
 * @mlc-ai/web-llm is a browser-only library (its bundle does `require('url')`). Metro bundles
 * dynamic imports too, so on iOS/Android it must resolve to an empty module or the native
 * bundle step fails with "Unable to resolve module url". Web must still get the real package.
 */
import path from 'node:path';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { createSharedMetroConfig } = require(path.resolve(__dirname, '..', '..', 'metro.shared.cjs'));

describe('Metro resolver for web-only packages', () => {
  const root = path.resolve(__dirname, '..', '..');
  const config = createSharedMetroConfig({
    projectRoot: root,
    primaryNodeModules: path.join(root, 'app', 'node_modules'),
    secondaryNodeModules: path.join(root, 'node_modules'),
    sentryWithMetroConfig: null,
  });
  const fallback = jest.fn(() => ({ type: 'sourceFile', filePath: '/real/web-llm.js' }));
  const context = { originModulePath: '/app/utils/assistantLocalModel.ts', resolveRequest: fallback } as any;

  beforeEach(() => fallback.mockClear());

  it.each(['ios', 'android'])('resolves @mlc-ai/web-llm to an empty module on %s', (platform) => {
    expect(config.resolver.resolveRequest(context, '@mlc-ai/web-llm', platform)).toEqual({ type: 'empty' });
    expect(fallback).not.toHaveBeenCalled();
  });

  it('leaves @mlc-ai/web-llm to the normal resolver on web', () => {
    expect(config.resolver.resolveRequest(context, '@mlc-ai/web-llm', 'web')).toEqual({ type: 'sourceFile', filePath: '/real/web-llm.js' });
    expect(fallback).toHaveBeenCalledTimes(1);
  });
});
