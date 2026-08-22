// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*', 'node_modules/*', '.expo/*', 'android/*', 'ios/*'],
  },
  {
    // ------------------------------------------------------------------
    // The colour system is only a single source of truth if it cannot be
    // bypassed. These rules make a hardcoded colour a lint ERROR, so the
    // inconsistency is caught at authoring time rather than discovered on
    // screen 40 when two greys don't match.
    // ------------------------------------------------------------------
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/theme/**'], // the theme is where colours are allowed to exist
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'Literal[value=/^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/]',
          message:
            'Hardcoded hex colour. Import a semantic token from "@/theme" instead — ' +
            'e.g. colors.text.primary. If no token fits, add one in src/theme/colors.ts.',
        },
        {
          selector: 'Literal[value=/^(?:rgba?|hsla?)\\(/]',
          message:
            'Hardcoded colour function. Use a token from "@/theme". Translucent fills ' +
            'live in colors.glass and primitives.alpha.',
        },
        {
          // Reaching past the semantic layer defeats the point of having one:
          // a rebrand would then have to hunt down primitive usages too.
          selector: 'ImportDeclaration[source.value=/theme\\/primitives$/]',
          message:
            'Do not import primitives directly. Components use semantic tokens from ' +
            '"@/theme"; primitives are an implementation detail of colors.ts.',
        },
      ],
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['../*', '../../*'],
              message: 'Use the "@/" alias instead of relative parent imports.',
            },
          ],
        },
      ],
    },
  },
]);
