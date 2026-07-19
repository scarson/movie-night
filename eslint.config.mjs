// ABOUTME: ESLint flat config — extends eslint-config-next, ignores build output and mockup.jsx.
// ABOUTME: mockup.jsx is functional-spec reference material, not application code.
import nextConfig from "eslint-config-next";

const eslintConfig = [
  { ignores: [".open-next/", ".next/", ".wrangler/", "mockup.jsx"] },
  ...nextConfig,
];

export default eslintConfig;
