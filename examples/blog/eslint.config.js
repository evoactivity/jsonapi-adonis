import { configApp } from '@adonisjs/eslint-config'

export default configApp({
  languageOptions: {
    parserOptions: {
      /**
       * Pin the TypeScript project root explicitly — this app is nested
       * inside the jsonapi-adonis repo, so editors running a single ESLint
       * server see two candidate tsconfig roots and refuse to guess.
       */
      tsconfigRootDir: import.meta.dirname,
    },
  },
})
