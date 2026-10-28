import { buildRelease, releasePlan as previewPlan, stableEndpoint } from './preview-release.mjs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
export function releasePlan(version, publicKey) {
  const plan = previewPlan(version, publicKey);
  return { ...plan, tag: `v${version}`, prerelease: false, endpoint: stableEndpoint,
    environment: { VEYMUX_DESKTOP_CHANNEL: 'stable', VEYMUX_STABLE_UPDATE_ENDPOINT: stableEndpoint, VEYMUX_STABLE_UPDATE_PUBLIC_KEY: publicKey },
    config: { ...plan.config, productName: 'Veymux', mainBinaryName: 'Veymux', identifier: 'com.jovines.veymux', bundle: { ...plan.config.bundle, macOS: { infoPlist: 'Info.plist' } } },
  };
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    const [version, destination] = process.argv.slice(2);
    if (!version || !destination) throw Error('Usage: node scripts/stable-release.mjs VERSION NEW_OUTPUT_DIRECTORY');
    // Retain the existing updater trust key; migration does not rotate keys.
    buildRelease(version, destination, process.env, releasePlan(version, process.env.VEYMUX_PREVIEW_UPDATE_PUBLIC_KEY));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
