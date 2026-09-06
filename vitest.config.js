import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    environment: 'jsdom',
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
