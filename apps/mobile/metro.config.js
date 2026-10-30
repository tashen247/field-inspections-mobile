// Expo's default config already understands pnpm workspaces (watches the repo root and
// resolves packages/shared from node_modules).
const { getDefaultConfig } = require('expo/metro-config');

module.exports = getDefaultConfig(__dirname);
