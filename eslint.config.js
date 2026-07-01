import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      'node_modules/**',
      'coverage/**',
      '.nyc_output/**',
      '.publish/**',
      'packages/adapters/claude-code/templates/**'
    ]
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: {
        ...globals.node
      }
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }]
    }
  },
  {
    // Test and script suites are plain ESM JavaScript, not typed sources.
    files: ['tests/**/*.mjs', 'scripts/**/*.mjs', '*.js', '*.mjs'],
    ...tseslint.configs.disableTypeChecked,
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }]
    }
  },
  prettier
);
