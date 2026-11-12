import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

import compassCore from "./eslint-rules/compass-core/index.mjs";

function withoutReactRules(config) {
	if (!config.rules) return config;

	return {
		...config,
		rules: Object.fromEntries(
			Object.entries(config.rules).filter(([ruleName]) => !ruleName.startsWith("react/")),
		),
	};
}

const eslintConfig = [
	{
		ignores: [
			".next/**",
			".open-next/**",
			".wrangler/**",
			"android/**",
			"conversations-interface-references/**",
			"dist-electron/**",
			"ios/**",
			"mobile-ui-references/**",
			"node_modules/**",
			"packages/**/dist/**",
			"references/**",
		],
	},
	...nextVitals.map(withoutReactRules),
	...nextTypescript,
	{
		rules: {
			"react/display-name": "off",
			"react/no-direct-mutation-state": "off",
			"react-hooks/purity": "off",
			"react-hooks/refs": "off",
			"react-hooks/set-state-in-effect": "off",
			"react-hooks/immutability": "off",
			"react-hooks/incompatible-library": "off",
			"react-hooks/static-components": "off",
			"react-hooks/use-memo": "off",
			"@typescript-eslint/no-require-imports": "off",
		},
	},
	// Compass Core table ownership (issue #1329, architecture-standards.md
	// section 1a). Existing violations live in eslint-suppressions.json, which
	// may only shrink (scripts/check-core-suppressions.mjs). Tests are exempt:
	// fixtures seed tables directly.
	{
		files: ["src/**/*.{ts,tsx,js,jsx,mjs}", "custom-worker.ts"],
		ignores: ["src/**/__tests__/**", "src/**/*.test.{ts,tsx}", "src/test/**"],
		plugins: { "compass-core": compassCore },
		rules: Object.fromEntries(
			Object.keys(compassCore.rules).map((rule) => [`compass-core/${rule}`, "error"]),
		),
	},
];

export default eslintConfig;
