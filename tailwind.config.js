/** Design tokens live in src/index.css as CSS variables (light + dark). Components use these names only. */
const v = (name) => `rgb(var(--${name}) / <alpha-value>)`;
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'media',
  theme: {
    extend: {
      fontFamily: { sans: ['"Plus Jakarta Sans"', 'ui-sans-serif', 'system-ui', 'Segoe UI', 'sans-serif'],
                    mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'] },
      colors: {
        bg: v('bg'), surface: v('surface'), sunken: v('sunken'), line: v('line'), 'line-strong': v('line-strong'),
        ink: v('ink'), muted: v('muted'), subtle: v('subtle'),
        brand: { DEFAULT: v('brand'), ink: v('brand-ink'), soft: v('brand-soft'), fg: v('brand-fg') },
        ok: { DEFAULT: v('ok'), soft: v('ok-soft') }, warn: { DEFAULT: v('warn'), soft: v('warn-soft') },
        bad: { DEFAULT: v('bad'), soft: v('bad-soft') }, info: { DEFAULT: v('info'), soft: v('info-soft') },
      },
      fontSize: { '2xs': ['0.75rem', { lineHeight: '1rem' }] },
      borderRadius: { DEFAULT: '6px', lg: '10px' },
      boxShadow: { card: '0 1px 2px 0 rgb(15 23 42 / 0.05)', pop: '0 8px 24px -6px rgb(15 23 42 / 0.18)' },
    },
  },
  plugins: [],
};
