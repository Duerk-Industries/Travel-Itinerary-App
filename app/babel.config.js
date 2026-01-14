module.exports = function(api) {
  api.cache(true);
  return {
    presets: [
      ['babel-preset-expo', { unstable_transformImportMeta: true }],
    ],
    plugins: [
      [
        'module:react-native-dotenv',
        { moduleName: '@env', safe: false, allowUndefined: false },
      ],
    ],
  };
}
