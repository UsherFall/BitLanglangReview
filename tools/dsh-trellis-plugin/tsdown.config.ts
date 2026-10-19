import { defineConfig } from "tsdown";
import { cpSync } from "node:fs";

export default defineConfig([
	{
		entry: ["src/index.ts"],
		dts: true,
		format: "esm",
		platform: "node",
		external: [
			"@deepseek-ai/cordis",
			"@deepseek-ai/dsh-scope",
			"@deepseek-ai/schemastery",
			"node:*"
		],
		onSuccess() {
			cpSync("src/dashboard.html", "dist/dashboard.html");
		}
	},
	{
		entry: ["src/client.ts"],
		outDir: "dist",
		// DSH 的浏览器端模块系统以经典 <script> 加载插件 client，要求
		// window.__ModuleLoader__.load({ id, factory }) 的 CJS-factory 包装
		// （factory 收到宿主提供的 require；react 等为平台种子模块）。
		// ESM 输出在经典脚本里是语法错误，宿主会报 "import failed"。
		format: "cjs",
		platform: "browser",
		external: ["react", "react/jsx-runtime", "react-dom"],
		outExtensions: () => ({ js: ".js" }),
		banner: [
			'window.__ModuleLoader__.load({',
			'\tid: "dsh-trellis",',
			'\tfactory: (require) => {',
			'\t\tvar module = { exports: {} };',
			'\t\tvar exports = module.exports;'
		].join("\n"),
		footer: [
			'\t\treturn module.exports;',
			'\t}',
			'});'
		].join("\n")
	}
]);
