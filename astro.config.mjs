import { defineConfig, fontProviders } from 'astro/config';

export default defineConfig({
	build: {
		inlineStylesheets: 'always'
	},
	fonts: [{
		provider: fontProviders.google(),
		name: 'Geist',
		cssVariable: '--font-geist',
		weights: [400, 500, 600, 700, 900]
	}]
});
