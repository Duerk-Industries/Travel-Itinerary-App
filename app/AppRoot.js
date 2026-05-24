'use strict';
Object.defineProperty(exports, '__esModule', { value: true });

const React = require('react');
const AppModule = require('./App');
const App = (AppModule && AppModule.default) ? AppModule.default : AppModule;

const isRenderableComponent = (value) =>
  typeof value === 'function' || (value && typeof value === 'object' && value.$$typeof);

if (!isRenderableComponent(App)) {
  const keys = AppModule && typeof AppModule === 'object' ? Object.keys(AppModule).join(', ') : 'none';
  throw new Error(`App module did not export a React component. Received ${typeof App}; keys: ${keys}`);
}

function AppRoot() {
  return React.createElement(App);
}

exports.default = AppRoot;
exports.AppRoot = AppRoot;
module.exports = AppRoot;
module.exports.default = AppRoot;
module.exports.AppRoot = AppRoot;
