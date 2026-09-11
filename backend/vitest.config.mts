import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // Les tests d'intégration du moteur de workflow parlent à une vraie base
    // Postgres (celle de DATABASE_URL, comme l'app elle-même) : les exécuter
    // en série évite les conflits de connexions/verrous entre fichiers de test.
    fileParallelism: false,
    testTimeout: 15000,
  },
});
