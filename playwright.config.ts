import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright設定ファイル
 * @see https://playwright.dev/docs/test-configuration
 */
export default defineConfig({
  testDir: './',
  /* テストの最大実行時間（AI処理に時間がかかるため3分に設定） */
  timeout: 3 * 60 * 1000,
  expect: {
    /* アサーションのタイムアウト */
    timeout: 5000
  },
  /* テストを並列実行するか */
  fullyParallel: false,
  /* CIで失敗した場合にリトライしない */
  forbidOnly: !!process.env.CI,
  /* 失敗したテストをリトライ（Ollamaの動作が不安定な場合に備えて） */
  retries: process.env.CI ? 2 : 1,
  /* 並列実行するワーカー数 */
  workers: process.env.CI ? 1 : 1,
  /* 使用するレポーター */
  reporter: 'html',
  /* 共有設定 */
  use: {
    /* アクションのタイムアウト */
    actionTimeout: 0,
    /* ベースURL */
    baseURL: 'https://www.yahoo.co.jp',
    /* 失敗時にスクリーンショットを取得 */
    screenshot: 'only-on-failure',
    /* 失敗時にトレースを取得 */
    trace: 'on-first-retry',
  },

  /* プロジェクト設定 */
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  /* ローカル開発サーバーを起動する場合の設定 */
  // webServer: {
  //   command: 'npm run start',
  //   url: 'http://127.0.0.1:3000',
  //   reuseExistingServer: !process.env.CI,
  // },
});

