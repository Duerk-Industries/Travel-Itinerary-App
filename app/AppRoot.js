'use strict';
Object.defineProperty(exports, '__esModule', { value: true });

const React = require('react');
const AppModule = require('./App');
const App = (AppModule && AppModule.default) ? AppModule.default : AppModule;

function AppRoot() {
  return React.createElement(App);
}

exports.default = AppRoot;
exports.AppRoot = AppRoot;
module.exports = AppRoot;
module.exports.default = AppRoot;
module.exports.AppRoot = AppRoot;
