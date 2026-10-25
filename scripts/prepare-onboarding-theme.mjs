import fs from 'node:fs';
import { buildOnboardingTheme } from '../dist/server/utils/onboardingTheme.js';

fs.writeFileSync(new URL('../dist/server/onboarding-theme.css', import.meta.url), buildOnboardingTheme());
