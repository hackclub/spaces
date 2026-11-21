const BROWSERS = [
  [/Edg(A|iOS)?\//, 'Edge'],
  [/OPR\/|Opera/, 'Opera'],
  [/Firefox\/|FxiOS\//, 'Firefox'],
  [/Chrome\/|CriOS\//, 'Chrome'],
  [/Safari\//, 'Safari']
];

const SYSTEMS = [
  [/iPad/, 'iPad'],
  [/iPhone|iPod/, 'iPhone'],
  [/Android/, 'Android'],
  [/CrOS/, 'ChromeOS'],
  [/Windows/, 'Windows'],
  [/Macintosh|Mac OS X/, 'macOS'],
  [/Linux/, 'Linux']
];

const match = (list, text) => list.find(([pattern]) => pattern.test(text))?.[1] ?? null;

export const describeUserAgent = (userAgent) => {
  if (!userAgent) return null;
  const browser = match(BROWSERS, userAgent);
  const system = match(SYSTEMS, userAgent);
  if (browser && system) return `${browser} on ${system}`;
  return browser || system || null;
};
