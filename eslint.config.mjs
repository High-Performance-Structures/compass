import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

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
];

export default eslintConfig;
