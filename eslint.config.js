import { configPkg } from '@adonisjs/eslint-config'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    /**
     * Global ignores — must live in an object with no other keys, otherwise
     * ESLint scopes the ignores to that config object only.
     */
    ignores: ['examples/**', 'build/**'],
  },

  ...configPkg(),

  /**
   * Type-aware linting on top of the AdonisJS preset (which only enables
   * the syntactic recommended rules).
   */
  ...tseslint.configs.recommendedTypeCheckedOnly,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        /**
         * Pin the TypeScript project root explicitly — with the example app
         * nested inside this repo, editors running a single ESLint server
         * see two candidate tsconfig roots and refuse to guess.
         */
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },

  /**
   * Plain JS files (this config file) have no type information.
   */
  {
    files: ['**/*.js'],
    ...tseslint.configs.disableTypeChecked,
  },

  /**
   * Tests assert raw JSON wire shapes; forcing the document types onto
   * every deep assertion would just restate the types under test. Unsafe-*
   * and explicit-any stay relaxed here — and only here.
   */
  {
    files: ['tests/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
    },
  }
)
