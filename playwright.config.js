import { defineConfig } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const dir=mkdtempSync(join(tmpdir(),'house-copy-browser-'));
export default defineConfig({
  testDir:'./test/browser',workers:1,retries:0,use:{baseURL:process.env.HOUSE_COPY_TEST_URL || 'http://127.0.0.1:13210',trace:'retain-on-failure'},
  webServer:process.env.HOUSE_COPY_TEST_URL ? undefined : {command:'node src/server.js',url:'http://127.0.0.1:13210/health',reuseExistingServer:false,env:{PORT:'13210',HOUSE_COPY_ADAPTER:'fake',HOUSE_COPY_DB:join(dir,'e2e.sqlite'),HOUSE_COPY_ORIGIN:'http://127.0.0.1:13210'}},
});
