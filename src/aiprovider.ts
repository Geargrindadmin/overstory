/**
 * AI Provider detection and configuration for Overstory.
 *
 * Handles detection and configuration for Claude Code and Kimi Code CLI.
 */

import { AgentError } from "./errors.ts";
import type {
	AgentCLIConfig,
	AIProviderConfig,
	AIProviderType,
	ResolvedAIProvider,
} from "./types.ts";

/** Claude Code CLI configuration */
const CLAUDE_CLI_CONFIG: AgentCLIConfig = {
	command: "claude",
	modelFlag: "--model",
	skipPermissionsFlag: "--dangerously-skip-permissions",
	apiKeyEnvVar: "ANTHROPIC_API_KEY",
	configDir: ".claude",
	instructionsFile: "CLAUDE.md",
	settingsFile: "settings.local.json",
	supportsHooks: true,
};

/** Kimi Code CLI configuration */
const KIMI_CLI_CONFIG: AgentCLIConfig = {
	command: "kimi",
	modelFlag: null, // Kimi doesn't use --model flag, uses KIMI_API_KEY
	skipPermissionsFlag: null,
	apiKeyEnvVar: "KIMI_API_KEY",
	configDir: ".kimi",
	instructionsFile: "KIMI.md",
	settingsFile: null, // Kimi doesn't support settings.local.json hooks
	supportsHooks: false,
};

/**
 * Check if a CLI command is available on PATH.
 */
async function isCommandAvailable(command: string): Promise<boolean> {
	try {
		const proc = Bun.spawn(["which", command], {
			stdout: "pipe",
			stderr: "pipe",
		});
		const exitCode = await proc.exited;
		return exitCode === 0;
	} catch {
		return false;
	}
}

/**
 * Check if the required API key environment variable is set.
 */
function hasApiKey(config: AgentCLIConfig): boolean {
	const apiKey = process.env[config.apiKeyEnvVar];
	return apiKey !== undefined && apiKey.length > 0;
}

/**
 * Detect which AI providers are available.
 *
 * Returns a map of provider types to availability status.
 */
export async function detectAvailableProviders(): Promise<{
	claude: { available: boolean; hasApiKey: boolean };
	kimi: { available: boolean; hasApiKey: boolean };
}> {
	const [claudeAvailable, kimiAvailable] = await Promise.all([
		isCommandAvailable(CLAUDE_CLI_CONFIG.command),
		isCommandAvailable(KIMI_CLI_CONFIG.command),
	]);

	return {
		claude: {
			available: claudeAvailable,
			hasApiKey: hasApiKey(CLAUDE_CLI_CONFIG),
		},
		kimi: {
			available: kimiAvailable,
			hasApiKey: hasApiKey(KIMI_CLI_CONFIG),
		},
	};
}

/**
 * Resolve the AI provider based on configuration and availability.
 *
 * @param config - The AI provider configuration from config.yaml
 * @returns The resolved provider with CLI configuration
 * @throws AgentError if no suitable provider can be found
 */
export async function resolveAIProvider(
	config: AIProviderConfig,
): Promise<ResolvedAIProvider> {
	const available = await detectAvailableProviders();

	// Helper to check if a provider is fully ready (CLI + API key)
	const isReady = (provider: "claude" | "kimi"): boolean => {
		return available[provider].available && available[provider].hasApiKey;
	};

	// If a specific provider is requested, use it
	if (config.type === "claude") {
		if (!isReady("claude")) {
			throw new AgentError(
				`AI provider "claude" is not available. ` +
					`CLI available: ${available.claude.available}, ` +
					`API key set: ${available.claude.hasApiKey}. ` +
					`Please install Claude Code and set ANTHROPIC_API_KEY.`,
			);
		}
		return {
			provider: "claude",
			cliConfig: CLAUDE_CLI_CONFIG,
			model: "sonnet", // Default model for Claude
		};
	}

	if (config.type === "kimi") {
		if (!isReady("kimi")) {
			throw new AgentError(
				`AI provider "kimi" is not available. ` +
					`CLI available: ${available.kimi.available}, ` +
					`API key set: ${available.kimi.hasApiKey}. ` +
					`Please install Kimi Code and set KIMI_API_KEY.`,
			);
		}
		return {
			provider: "kimi",
			cliConfig: KIMI_CLI_CONFIG,
			model: "kimi-k2.5",
		};
	}

	// Auto-detection mode
	const preferred = config.preferred ?? "claude";

	// Try preferred provider first
	if (preferred === "claude" && isReady("claude")) {
		return {
			provider: "claude",
			cliConfig: CLAUDE_CLI_CONFIG,
			model: "sonnet",
		};
	}

	if (preferred === "kimi" && isReady("kimi")) {
		return {
			provider: "kimi",
			cliConfig: KIMI_CLI_CONFIG,
			model: "kimi-k2.5",
		};
	}

	// Fall back to the other provider if allowed
	if (config.allowFallback) {
		const fallback = preferred === "claude" ? "kimi" : "claude";
		if (isReady(fallback)) {
			return {
				provider: fallback,
				cliConfig: fallback === "claude" ? CLAUDE_CLI_CONFIG : KIMI_CLI_CONFIG,
				model: fallback === "claude" ? "sonnet" : "kimi-k2.5",
			};
		}
	}

	// No suitable provider found
	throw new AgentError(
		`No AI provider is available. Tried: ${preferred}${config.allowFallback ? ` and fallback` : ""}. ` +
			`Claude: CLI=${available.claude.available}, API key=${available.claude.hasApiKey}. ` +
			`Kimi: CLI=${available.kimi.available}, API key=${available.kimi.hasApiKey}. ` +
			`Please install Claude Code (anthropic) or Kimi Code and set the appropriate API key.`,
	);
}

/**
 * Get the CLI configuration for a specific provider type.
 */
export function getCLIConfig(provider: AIProviderType): AgentCLIConfig {
	switch (provider) {
		case "claude":
			return CLAUDE_CLI_CONFIG;
		case "kimi":
			return KIMI_CLI_CONFIG;
		case "auto":
			throw new AgentError(
				"Cannot get CLI config for 'auto' provider type. Call resolveAIProvider() first.",
			);
		default:
			throw new AgentError(`Unknown AI provider type: ${provider}`);
	}
}

/**
 * Build the spawn command for an AI agent.
 *
 * @param cliConfig - The CLI configuration for the provider
 * @param model - The model to use (if supported)
 * @returns The command string to spawn the agent
 */
export function buildSpawnCommand(
	cliConfig: AgentCLIConfig,
	model?: string,
): string {
	const parts: string[] = [cliConfig.command];

	// Add model flag if supported and model is provided
	if (cliConfig.modelFlag && model) {
		parts.push(cliConfig.modelFlag, model);
	}

	// Add skip permissions flag if supported
	if (cliConfig.skipPermissionsFlag) {
		parts.push(cliConfig.skipPermissionsFlag);
	}

	return parts.join(" ");
}

/**
 * Get environment variables for the AI provider.
 *
 * @param cliConfig - The CLI configuration
 * @param overrides - Additional environment variables to include
 * @returns Environment variables record
 */
export function getProviderEnv(
	cliConfig: AgentCLIConfig,
	overrides?: Record<string, string>,
): Record<string, string> {
	const env: Record<string, string> = {};

	// Copy the API key env var (it should already be set in parent process)
	const apiKey = process.env[cliConfig.apiKeyEnvVar];
	if (apiKey) {
		env[cliConfig.apiKeyEnvVar] = apiKey;
	}

	// Add overrides
	if (overrides) {
		for (const [key, value] of Object.entries(overrides)) {
			env[key] = value;
		}
	}

	return env;
}
