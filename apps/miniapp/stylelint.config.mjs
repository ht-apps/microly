/** @type {import('stylelint').Config} */
export default {
  extends: "stylelint-config-standard",
  rules: {
    "alpha-value-notation": "number",
    "color-function-alias-notation": null,
    "color-function-notation": "legacy",
    "selector-class-pattern": "^[a-z][a-z0-9-]*(?:__[a-z0-9-]+)?(?:--[a-z0-9-]+)?$",
    "selector-type-no-unknown": [true, { ignoreTypes: ["page"] }],
  },
};
