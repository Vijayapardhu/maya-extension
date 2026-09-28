import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    environment: 'jsdom',
    // A test-page URL, so content.js resolves a test ID the way it does live.
    environmentOptions: { jsdom: { url: 'https://maya.test/grand-assessment/test-123' } },
    globals: true,
    setupFiles: ['./tests/setup.js'],
    resolve: {
      alias: {
        'https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js': path.resolve('./tests/mocks/firebase-app.js'),
        'https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js': path.resolve('./tests/mocks/firebase-firestore.js'),
      },
    },
  },
});
