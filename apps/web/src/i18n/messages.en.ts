/**
 * All user-facing text lives here (English only for now). Screens never hard-code strings,
 * so adding a language later means adding a catalogue, not editing screens.
 */
export const en = {
  app: {
    name: 'ILACORE',
    tagline: 'LPG cylinder lifecycle, distribution and loss intelligence',
    skipToContent: 'Skip to main content',
  },
  home: {
    heading: 'ILACORE',
    status: 'Foundation in progress. Sign-in and role dashboards come next.',
  },
} as const;

export type Messages = typeof en;
