import { generateEslintConfig } from '@companion-module/tools/eslint/config.mjs'

const baseConfig = await generateEslintConfig({
	enableTypescript: true,
	ignores: ['vitest.config.ts'],
})

const customConfig = [
	...baseConfig,
	{
		// Tests and their helpers, none of which are built into dist
		files: ['src/**/*.spec.ts', 'src/**/__tests__/**/*.ts'],
		rules: {
			'n/no-unpublished-import': 'off',
		},
	},
]

export default customConfig
