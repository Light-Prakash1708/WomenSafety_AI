// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require("eslint/config");
const expoConfig = require("eslint-config-expo/flat");

module.exports = defineConfig([
  expoConfig,
  // React Native <Text> renders quotes and apostrophes literally.
  { rules: { "react/no-unescaped-entities": "off" } },
  { ignores: ["dist/*", "supabase/functions/*", "web/*"] },
]);
