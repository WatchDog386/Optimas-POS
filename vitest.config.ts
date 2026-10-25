import os from 'node:os'
import path from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['fake-indexeddb/auto'],
    // Server tests get a throwaway SQLite file, never the shop's data/optimas.db.
    env: { DB_PATH: path.join(os.tmpdir(), `optimas-test-${process.pid}.db`), AUTH_SECRET: '' },
    fileParallelism: false,
  },
})
