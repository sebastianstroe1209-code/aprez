// Metro config for the Expo app inside this npm-workspaces monorepo.
//
// The mobile app imports shared design tokens via a relative path into
// <repo>/packages/shared (see src/lib/colors.js). That directory lives
// OUTSIDE the app folder, so Metro's default config — which only watches
// the project root — cannot resolve it and the bundle fails with
// "Unable to resolve module ../../../../packages/shared/theme/colors".
//
// This is the standard Expo monorepo setup (Expo docs › Work with
// monorepos): watch the repo root so cross-package files resolve, and
// look for modules in both the app's and the root's node_modules so
// hoisted dependencies are found.

const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [monorepoRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(monorepoRoot, 'node_modules'),
];

module.exports = config;
