import { defineConfig, devices } from '@playwright/test';

// Tesla's in-car browser is Chromium-based, so chromium is the faithful target.
// Each run starts the real server against a throwaway state file.
export default defineConfig({
	testDir: './e2e',
	fullyParallel: false,
	workers: 1,
	forbidOnly: !!process.env.CI,
	reporter: [['list']],
	use: {
		baseURL: 'http://localhost:4173',
		trace: 'retain-on-failure'
	},
	projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
	webServer: {
		command: 'rm -rf .e2e-data && STATE_FILE=.e2e-data/state.json PORT=4173 bun server/index.ts',
		url: 'http://localhost:4173/',
		reuseExistingServer: false,
		timeout: 30_000
	}
});
