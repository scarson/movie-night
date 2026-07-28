// ABOUTME: PostCSS configuration — wires up the Tailwind CSS v4 plugin.
// ABOUTME: No other transforms needed.
/** @type {import('postcss-load-config').Config} */
const config = {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};

export default config;
