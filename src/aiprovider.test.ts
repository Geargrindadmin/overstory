import { describe, expect, it } from "bun:test";
import {
	buildSpawnCommand,
	getCLIConfig,
	getProviderEnv,
} from "./aiprovider.ts";

describe("buildSpawnCommand", () => {
	it("should build Claude command with model flag", () => {
		const cliConfig = {
			command: "claude",
			modelFlag: "--model",
			skipPermissionsFlag: "--dangerously-skip-permissions",
			apiKeyEnvVar: "ANTHROPIC_API_KEY",
			configDir: ".claude",
			instructionsFile: "CLAUDE.md",
			settingsFile: "settings.local.json",
			supportsHooks: true,
		};
		const result = buildSpawnCommand(cliConfig, "sonnet");
		expect(result).toBe("claude --model sonnet --dangerously-skip-permissions");
	});

	it("should build Kimi command without model flag", () => {
		const cliConfig = {
			command: "kimi",
			modelFlag: null,
			skipPermissionsFlag: null,
			apiKeyEnvVar: "KIMI_API_KEY",
			configDir: ".kimi",
			instructionsFile: "KIMI.md",
			settingsFile: null,
			supportsHooks: false,
		};
		const result = buildSpawnCommand(cliConfig, "kimi-k2.5");
		expect(result).toBe("kimi");
	});
});

describe("getCLIConfig", () => {
	it("should return Claude config for claude provider", () => {
		const config = getCLIConfig("claude");
		expect(config.command).toBe("claude");
		expect(config.supportsHooks).toBe(true);
		expect(config.configDir).toBe(".claude");
	});

	it("should return Kimi config for kimi provider", () => {
		const config = getCLIConfig("kimi");
		expect(config.command).toBe("kimi");
		expect(config.supportsHooks).toBe(false);
		expect(config.configDir).toBe(".kimi");
	});

	it("should throw for auto provider", () => {
		expect(() => getCLIConfig("auto")).toThrow();
	});
});

describe("getProviderEnv", () => {
	it("should include API key env var when set", () => {
		process.env.KIMI_API_KEY = "test-key";
		const cliConfig = {
			command: "kimi",
			modelFlag: null,
			skipPermissionsFlag: null,
			apiKeyEnvVar: "KIMI_API_KEY",
			configDir: ".kimi",
			instructionsFile: "KIMI.md",
			settingsFile: null,
			supportsHooks: false,
		};
		const env = getProviderEnv(cliConfig);
		expect(env.KIMI_API_KEY).toBe("test-key");
		delete process.env.KIMI_API_KEY;
	});

	it("should include overrides", () => {
		const cliConfig = {
			command: "kimi",
			modelFlag: null,
			skipPermissionsFlag: null,
			apiKeyEnvVar: "KIMI_API_KEY",
			configDir: ".kimi",
			instructionsFile: "KIMI.md",
			settingsFile: null,
			supportsHooks: false,
		};
		const env = getProviderEnv(cliConfig, { CUSTOM_VAR: "custom" });
		expect(env.CUSTOM_VAR).toBe("custom");
	});
});
