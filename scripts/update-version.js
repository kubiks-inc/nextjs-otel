#!/usr/bin/env node

import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Read package.json
const packageJsonPath = join(__dirname, '..', 'package.json');
const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
const version = packageJson.version;

// Update version.ts
const versionFilePath = join(__dirname, '..', 'src', 'version.ts');
const versionFileContent = `/**
 * Package version constant
 * This is automatically updated during the release process
 * @constant
 */
export const PACKAGE_VERSION = '${version}';

/**
 * Gets the current package version
 * @returns The package version string
 */
export function getPackageVersion(): string {
    return PACKAGE_VERSION;
}`;

writeFileSync(versionFilePath, versionFileContent);
console.log(`Updated version.ts with version ${version}`);