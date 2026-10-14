// Extends app.json. EXPO_BASE_URL lets the web build live under a sub-path,
// e.g. https://<user>.github.io/WomenSafety_AI (set by the Pages workflow).
module.exports = ({ config }) => ({
  ...config,
  experiments: {
    ...config.experiments,
    ...(process.env.EXPO_BASE_URL ? { baseUrl: process.env.EXPO_BASE_URL } : {}),
  },
});
