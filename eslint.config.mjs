// ABOUTME: ESLint flat config — extends eslint-config-next, ignores build output and mockup.jsx.
// ABOUTME: mockup.jsx is functional-spec reference material, not application code.
import nextConfig from "eslint-config-next";

const eslintConfig = [
  { ignores: [".open-next/", ".next/", ".wrangler/", "mockup.jsx"] },
  ...nextConfig,
  // AI-generated text must render as text: dangerouslySetInnerHTML is banned repo-wide.
  // The only formatting honored is the **bold** marker, parsed by src/components/bold-text.tsx.
  { rules: { "react/no-danger": "error" } },
];

export default eslintConfig;
