import nextConfig from "eslint-config-next";

const config = [
  {
    ignores: [".claude/**", "memory/**"],
  },
  ...nextConfig,
  {
    rules: {
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/refs": "off",
      "react-hooks/immutability": "off",
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
];

export default config;
