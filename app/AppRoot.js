'use strict';
Object.defineProperty(exports, '__esModule', { value: true });

const React = require('react');
const AppModule = require('./App');
const App = (AppModule && AppModule.default) ? AppModule.default : AppModule;

// `react-native-safe-area-context` is required transitively by
// `@react-navigation/native`. Without `<SafeAreaProvider>` as an ancestor,
// `SafeAreaView` (from this package) and `useSafeAreaInsets()` return zero
// insets on iOS, causing the auth form / nav bar to render under the notch
// or dynamic island on iPhone X+ devices. Web and Android usually mask the
// issue because there's no notch insets to honour.
const SafeAreaContextModule = require('react-native-safe-area-context');
const SafeAreaProvider =
  SafeAreaContextModule && SafeAreaContextModule.SafeAreaProvider
    ? SafeAreaContextModule.SafeAreaProvider
    : null;

const isRenderableComponent = (value) =>
  typeof value === 'function' || (value && typeof value === 'object' && value.$$typeof);

if (!isRenderableComponent(App)) {
  const keys = AppModule && typeof AppModule === 'object' ? Object.keys(AppModule).join(', ') : 'none';
  throw new Error(`App module did not export a React component. Received ${typeof App}; keys: ${keys}`);
}

function AppRoot() {
  const appElement = React.createElement(App);
  if (!SafeAreaProvider) return appElement;
  return React.createElement(SafeAreaProvider, null, appElement);
}

exports.default = AppRoot;
exports.AppRoot = AppRoot;
module.exports = AppRoot;
module.exports.default = AppRoot;
module.exports.AppRoot = AppRoot;
