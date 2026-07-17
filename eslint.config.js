import eslint from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'public/art/**',
      'public/ui/**',
      'sources/**',
      'src/irc/gamja/**',
      'vendor/**',
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      globals: globals.browser,
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
        },
      ],
      // IRC and Comic Chat formatting protocols use literal control bytes.
      'no-control-regex': 'off',
    },
  },
  {
    files: ['*.{js,mjs,ts}', 'tools/**/*.{js,mjs,ts}'],
    languageOptions: {
      globals: globals.node,
    },
  },
);
