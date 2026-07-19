import nextConfig from "eslint-config-next";

const eslintConfig = [
  { ignores: [".open-next/", ".next/", ".wrangler/", "mockup.jsx"] },
  ...nextConfig,
];

export default eslintConfig;
