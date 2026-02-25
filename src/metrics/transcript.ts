/**
 * Parser for AI agent transcript JSONL files.
 *
 * Supports both Claude Code and Kimi Code transcript formats.
 *
 * Claude Code format (at ~/.claude/projects/{project-slug}/{session-id}.jsonl):
 * {
 *   "type": "assistant",
 *   "message": {
 *     "model": "claude-opus-4-6",
 *     "usage": {
 *       "input_tokens": 3,
 *       "output_tokens": 9,
 *       "cache_read_input_tokens": 19401,
 *       "cache_creation_input_tokens": 9918
 *     }
 *   }
 * }
 *
 * Kimi Code format (may vary - this parser attempts to extract common fields):
 * {
 *   "type": "assistant",
 *   "message": {
 *     "model": "kimi-k2.5",
 *     "usage": {
 *       "input_tokens": 100,
 *       "output_tokens": 50
 *     }
 *   }
 * }
 */

export interface TranscriptUsage {
	inputTokens: number;
	outputTokens: number;
	cacheReadTokens: number;
	cacheCreationTokens: number;
	modelUsed: string | null;
}

/** Pricing per million tokens (USD). */
interface ModelPricing {
	inputPerMTok: number;
	outputPerMTok: number;
	cacheReadPerMTok: number;
	cacheCreationPerMTok: number;
}

/** Hardcoded pricing for known AI models (USD per million tokens). */
const MODEL_PRICING: Record<string, ModelPricing> = {
	// Claude models
	opus: {
		inputPerMTok: 15,
		outputPerMTok: 75,
		cacheReadPerMTok: 1.5, // 10% of input
		cacheCreationPerMTok: 3.75, // 25% of input
	},
	sonnet: {
		inputPerMTok: 3,
		outputPerMTok: 15,
		cacheReadPerMTok: 0.3, // 10% of input
		cacheCreationPerMTok: 0.75, // 25% of input
	},
	haiku: {
		inputPerMTok: 0.8,
		outputPerMTok: 4,
		cacheReadPerMTok: 0.08, // 10% of input
		cacheCreationPerMTok: 0.2, // 25% of input
	},
	// Kimi models (approximate pricing - update as needed)
	"kimi-k2.5": {
		inputPerMTok: 2,
		outputPerMTok: 8,
		cacheReadPerMTok: 0, // No caching in Kimi
		cacheCreationPerMTok: 0,
	},
};

/**
 * Determine the pricing tier for a given model string.
 * Matches on substring: "opus" -> opus pricing, "sonnet" -> sonnet, "haiku" -> haiku, "kimi" -> kimi.
 * Returns null if unrecognized.
 */
function getPricingForModel(model: string): ModelPricing | null {
	const lower = model.toLowerCase();
	if (lower.includes("opus")) return MODEL_PRICING.opus ?? null;
	if (lower.includes("sonnet")) return MODEL_PRICING.sonnet ?? null;
	if (lower.includes("haiku")) return MODEL_PRICING.haiku ?? null;
	if (lower.includes("kimi")) return MODEL_PRICING["kimi-k2.5"] ?? null;
	return null;
}

/**
 * Calculate the estimated cost in USD for a given usage and model.
 * Returns null if the model is unrecognized.
 */
export function estimateCost(usage: TranscriptUsage): number | null {
	if (usage.modelUsed === null) return null;

	const pricing = getPricingForModel(usage.modelUsed);
	if (pricing === null) return null;

	const inputCost = (usage.inputTokens / 1_000_000) * pricing.inputPerMTok;
	const outputCost = (usage.outputTokens / 1_000_000) * pricing.outputPerMTok;
	const cacheReadCost = (usage.cacheReadTokens / 1_000_000) * pricing.cacheReadPerMTok;
	const cacheCreationCost = (usage.cacheCreationTokens / 1_000_000) * pricing.cacheCreationPerMTok;

	return inputCost + outputCost + cacheReadCost + cacheCreationCost;
}

/**
 * Narrow an unknown value to determine if it looks like a transcript assistant entry.
 * Supports both Claude and Kimi transcript formats.
 * Returns the usage fields if valid, or null otherwise.
 */
function extractUsageFromEntry(entry: unknown): {
	inputTokens: number;
	outputTokens: number;
	cacheReadTokens: number;
	cacheCreationTokens: number;
	model: string | undefined;
} | null {
	if (typeof entry !== "object" || entry === null) return null;

	const obj = entry as Record<string, unknown>;
	if (obj.type !== "assistant") return null;

	const message = obj.message;
	if (typeof message !== "object" || message === null) return null;

	const msg = message as Record<string, unknown>;
	const usage = msg.usage;
	if (typeof usage !== "object" || usage === null) return null;

	const u = usage as Record<string, unknown>;

	// Support both Claude and Kimi token field names
	// Claude uses input_tokens/output_tokens, Kimi may use similar or different names
	const inputTokens = 
		typeof u.input_tokens === "number" ? u.input_tokens :
		typeof u.prompt_tokens === "number" ? u.prompt_tokens : 0;
	
	const outputTokens = 
		typeof u.output_tokens === "number" ? u.output_tokens :
		typeof u.completion_tokens === "number" ? u.completion_tokens : 0;

	return {
		inputTokens,
		outputTokens,
		// Kimi may not have caching, default to 0
		cacheReadTokens: typeof u.cache_read_input_tokens === "number" ? u.cache_read_input_tokens : 0,
		cacheCreationTokens:
			typeof u.cache_creation_input_tokens === "number" ? u.cache_creation_input_tokens : 0,
		model: typeof msg.model === "string" ? msg.model : undefined,
	};
}

/**
 * Parse an AI agent transcript JSONL file and aggregate token usage.
 *
 * Supports both Claude Code and Kimi Code transcript formats.
 * Reads the file line by line, extracting usage data from each assistant
 * entry. Returns aggregated totals and the model from the first assistant turn.
 *
 * @param transcriptPath - Absolute path to the transcript JSONL file
 * @returns Aggregated usage data across all assistant turns
 */
export async function parseTranscriptUsage(transcriptPath: string): Promise<TranscriptUsage> {
	const file = Bun.file(transcriptPath);
	const text = await file.text();
	const lines = text.split("\n");

	const result: TranscriptUsage = {
		inputTokens: 0,
		outputTokens: 0,
		cacheReadTokens: 0,
		cacheCreationTokens: 0,
		modelUsed: null,
	};

	for (const line of lines) {
		const trimmed = line.trim();
		if (trimmed.length === 0) continue;

		let parsed: unknown;
		try {
			parsed = JSON.parse(trimmed);
		} catch {
			// Skip malformed lines
			continue;
		}

		const usage = extractUsageFromEntry(parsed);
		if (usage === null) continue;

		result.inputTokens += usage.inputTokens;
		result.outputTokens += usage.outputTokens;
		result.cacheReadTokens += usage.cacheReadTokens;
		result.cacheCreationTokens += usage.cacheCreationTokens;

		// Capture model from first assistant turn
		if (result.modelUsed === null && usage.model !== undefined) {
			result.modelUsed = usage.model;
		}
	}

	return result;
}
