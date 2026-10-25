import fs from 'node:fs';

/** The HTTP setup page uses the same token source as the application. */
export function buildOnboardingTheme(): string {
  const source = fs.readFileSync(new URL('../../../src/index.css', import.meta.url), 'utf8');
  const tokens = ['background', 'foreground', 'surface', 'surface-2', 'muted-foreground', 'border', 'primary', 'primary-foreground', 'warning', 'accent'];
  const block = (selector: string) => {
    const start = source.indexOf(`${selector} {`);
    if (start < 0) throw new Error(`Missing theme: ${selector}`);
    const body = source.slice(start, source.indexOf('\n}', start));
    return tokens.map(name => {
      const value = body.match(new RegExp(`--${name}:\\s*([^;]+);`))?.[1];
      if (!value) throw new Error(`Missing token: ${name}`);
      return `--${name}:${value};`;
    }).join('');
  };
  return `:root{${block(':root')}}@media(prefers-color-scheme:light){:root{${block("html[data-theme='light']")}}}`;
}

export function loadOnboardingTheme(): string {
  const built = new URL('../onboarding-theme.css', import.meta.url);
  return fs.existsSync(built) ? fs.readFileSync(built, 'utf8') : buildOnboardingTheme();
}
