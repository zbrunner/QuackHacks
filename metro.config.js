const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

// Bundle audio assets via require() — Metro doesn't include these by default.
config.resolver.assetExts = [
  ...config.resolver.assetExts,
  "wav",
  "mp3",
  "m4a",
  "aac",
  "ogg",
];

module.exports = config;
