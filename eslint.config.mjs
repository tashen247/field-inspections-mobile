import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/coverage/**',
      '**/cdk.out/**',
      'apps/mobile/.expo/**',
      'apps/mobile/android/**',
      'apps/mobile/ios/**',
      'apps/mobile/expo-env.d.ts',
      'apps/mobile/drizzle/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-non-null-assertion': 'off',
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
  {
    files: [
      '**/test/**',
      '**/scripts/**',
      '**/*.config.*',
      '**/src/db/seed.ts',
      '**/src/db/migrate.ts',
      '**/__tests__/**',
    ],
    rules: { 'no-console': 'off' },
  },
  {
    files: ['apps/mobile/src/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: { ...reactHooks.configs.recommended.rules },
  },
  {
    files: ['apps/mobile/jest.setup.js'],
    languageOptions: { globals: { ...globals.jest } },
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
  {
    files: ['**/*.cjs', 'apps/mobile/*.js'],
    languageOptions: { sourceType: 'commonjs', globals: { ...globals.node } },
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
  prettier,
);
