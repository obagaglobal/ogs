// @ts-check
import js from '@eslint/js';
import prettier from 'eslint-config-prettier/flat';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import { defineConfig, globalIgnores } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig(
  globalIgnores([
    '**/dist/**',
    '**/dist-worker/**',
    '**/coverage/**',
    '**/node_modules/**',
    'apps/api/src/generated/**',
  ]),

  // Baseline for every file.
  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    linterOptions: {
      reportUnusedDisableDirectives: 'error',
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/no-import-type-side-effects': 'error',
      eqeqeq: ['error', 'always'],
      'no-console': ['error', { allow: ['warn', 'error'] }],
    },
  },

  // Plain JavaScript (config files, scripts): no type information available.
  {
    files: ['**/*.{js,mjs,cjs}'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: { globals: globals.node },
    rules: { 'no-console': 'off' },
  },

  // Backend (NestJS).
  {
    files: ['apps/api/**/*.ts'],
    languageOptions: { globals: globals.node },
    rules: {
      // Nest modules are intentionally empty decorated classes.
      '@typescript-eslint/no-extraneous-class': ['error', { allowWithDecorator: true }],
      // Nest DI needs runtime (value) imports for constructor-injected classes.
      '@typescript-eslint/consistent-type-imports': 'off',
    },
  },

  // Database boundary (review §6.2): only src/database/ may touch Prisma or pg
  // directly. Everything else goes through TenantDb, which always sets the RLS
  // context first. Feature code imports the database layer via its index only.
  {
    files: ['apps/api/src/**/*.ts'],
    ignores: ['apps/api/src/database/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/generated/prisma', '**/generated/prisma/**', '@prisma/*', 'pg', 'pg/*'],
              message:
                'Use TenantDb (and types) from src/database/index.js. Raw Prisma/pg bypasses the RLS context.',
            },
            {
              group: ['**/database/*', '!**/database/index.js'],
              message: 'Import the database layer from src/database/index.js only.',
            },
          ],
        },
      ],
      'no-restricted-properties': [
        'error',
        {
          property: '$queryRawUnsafe',
          message: 'Use the $queryRaw tagged template: it parameterises every value.',
        },
        {
          property: '$executeRawUnsafe',
          message: 'Use the $executeRaw tagged template: it parameterises every value.',
        },
      ],
    },
  },

  // Frontend (React + Vite).
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    extends: [reactHooks.configs.flat['recommended-latest'], reactRefresh.configs.vite],
    languageOptions: { globals: globals.browser },
  },

  // Tests.
  {
    files: ['**/*.test.{ts,tsx}', '**/test/**/*.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
    },
  },

  // Must be last: turns off rules that conflict with Prettier.
  prettier,
);
