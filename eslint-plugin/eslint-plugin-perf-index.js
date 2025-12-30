/**
 * eslint-plugin-perf
 * 
 * JavaScript パフォーマンス問題を検出・修正する ESLint プラグイン
 */

const noComputedPropertyMethod = require('./rules/no-computed-property-method');

module.exports = {
  meta: {
    name: 'perf',
    version: '1.0.0',
  },
  rules: {
    'no-computed-property-method': noComputedPropertyMethod,
  },
  configs: {
    recommended: {
      plugins: ['perf'],
      rules: {
        'perf/no-computed-property-method': 'warn',
      },
    },
  },
};
