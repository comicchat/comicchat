export default {
  '*.{js,mjs,ts}': ['eslint --fix --max-warnings=0 --no-warn-ignored', 'prettier --write'],
  '*.{css,html,json,md,yaml,yml}': 'prettier --write',
};
