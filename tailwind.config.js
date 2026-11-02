/** Design tokens live in src/index.css as CSS variables (light + dark). Components use these names only. */
const v = (name) => `rgb(var(--${name}) / <alpha-value>)`;
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: ['selector', '[data-theme="dark"]'],
  theme: {
    extend: {
      fontFamily: { sans: ['"Plus Jakarta Sans"', 'ui-sans-serif', 'system-ui', 'Segoe UI', 'sans-serif'],
                    mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'] },
      colors: {
        bg: v('bg'), surface: v('surface'), sunken: v('sunken'), line: v('line'), 'line-strong': v('line-strong'),
        ink: v('ink'), muted: v('muted'), subtle: v('subtle'),
        brand: { DEFAULT: v('brand'), ink: v('brand-ink'), soft: v('brand-soft'), fg: v('brand-fg') },
        leaf: v('leaf'), sun: v('sun'), sky: v('sky'), canopy: { DEFAULT: v('canopy'), fg: v('canopy-fg') },
        ok: { DEFAULT: v('ok'), soft: v('ok-soft'), fg: v('ok-fg') }, warn: { DEFAULT: v('warn'), soft: v('warn-soft') },
        bad: { DEFAULT: v('bad'), soft: v('bad-soft'), fg: v('bad-fg') }, info: { DEFAULT: v('info'), soft: v('info-soft') },
      },
      fontSize: { '2xs': ['0.75rem', { lineHeight: '1rem' }] },
      borderRadius: { DEFAULT: '6px', lg: '10px' },
      boxShadow: { card: '0 1px 3px 0 rgb(var(--shade) / 0.07)', pop: '0 10px 28px -8px rgb(var(--shade) / 0.25)' },
    },
  },
  plugins: [],
};
