const React = require('react');
const AppModule = require('./App');

const App = AppModule && AppModule.default ? AppModule.default : AppModule;

function AppRoot() {
  return React.createElement(App);
}

module.exports = AppRoot;
module.exports.default = AppRoot;
