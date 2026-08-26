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
      // Пропущенная зависимость в useMemo однажды заморозила контекст кабинета:
      // сервер присылал уровень доступа, а интерфейс его не видел — кнопки и
      // пункт меню просто не появлялись, и это выглядело как «функция закрыта».
      // Такая поломка не даёт ни ошибки в консоли, ни падения сборки, поэтому
      // ловим её линтером.
      "react-hooks/exhaustive-deps": "error",
    },
  },
];

export default config;
