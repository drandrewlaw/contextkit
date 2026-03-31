import type {
	CompactionResult,
	ContextKitConfig,
	ContextWarningState,
	Message,
	MicroCompactResult,
} from "../types/index.js";
import {
	estimateConversationTokens,
	groupMessagesByRound,
} from "../tokens/index.js";
import { buildCompactPrompt, formatCompactedSummary } from "./prompt.js";
import { microCompact, stripImages } from "./micro.js";

/** Default constants extracted from Claude Code */
const DEFAULTS = {
	maxOutputTokens: 32_000,
	autoCompactBuffer: 13_000,
	warningBuffer: 20_000,
	maxConsecutiveFailures: 3,
	summaryMaxTokens: 20_000,
	microCompactKeepRecent: 5,
} as const;

/**
 * ContextKit — intelligent conversation compaction for any LLM.
 *
 * @example
 * ```ts
 * const ctx = createContextKit({
 *   contextWindowSize: 200_000,
 *   summarize: async (messages, prompt) => {
 *     const resp = await openai.chat.completions.create({
 *       model: 'gpt-4o',
 *       messages: [
 *         ...messages.map(m => ({ role: m.role, content: m.content as string })),
 *         { role: 'user', content: prompt },
 *       ],
 *     })
 *     return resp.choices[0].message.content
 *   },
 * })
 *
 * // Check if compaction is needed
 * if (ctx.shouldCompact(messages)) {
 *   const result = await ctx.compact(messages)
 *   messages = result.messages
 * }
 * ```
 */
export class ContextKit {
	private config: Required<
		Pick<
			ContextKitConfig,
			| "contextWindowSize"
			| "maxOutputTokens"
			| "autoCompactBuffer"
			| "warningBuffer"
			| "maxConsecutiveFailures"
			| "summaryMaxTokens"
			| "microCompactKeepRecent"
		>
	> &
		ContextKitConfig;
	private consecutiveFailures = 0;
	private lastWarningState: ContextWarningState = "ok";

	constructor(config: ContextKitConfig) {
		this.config = {
			maxOutputTokens: config.maxOutputTokens ?? DEFAULTS.maxOutputTokens,
			autoCompactBuffer:
				config.autoCompactBuffer ?? DEFAULTS.autoCompactBuffer,
			warningBuffer: config.warningBuffer ?? DEFAULTS.warningBuffer,
			maxConsecutiveFailures:
				config.maxConsecutiveFailures ?? DEFAULTS.maxConsecutiveFailures,
			summaryMaxTokens:
				config.summaryMaxTokens ?? DEFAULTS.summaryMaxTokens,
			microCompactKeepRecent:
				config.microCompactKeepRecent ?? DEFAULTS.microCompactKeepRecent,
			...config,
		};
	}

	/**
	 * The effective context window after reserving space for output.
	 */
	get effectiveWindow(): number {
		const reserved = Math.min(
			this.config.maxOutputTokens,
			this.config.summaryMaxTokens,
		);
		return this.config.contextWindowSize - reserved;
	}

	/**
	 * The token threshold that triggers auto-compaction.
	 */
	get autoCompactThreshold(): number {
		return this.effectiveWindow - this.config.autoCompactBuffer;
	}

	/**
	 * Estimate token count for messages.
	 */
	estimateTokens(messages: readonly Message[]): number {
		return estimateConversationTokens(messages, this.config.estimateTokens);
	}

	/**
	 * Check the context warning state for a set of messages.
	 */
	getWarningState(messages: readonly Message[]): ContextWarningState {
		const tokens = this.estimateTokens(messages);
		const threshold = this.autoCompactThreshold;

		let state: ContextWarningState;
		if (tokens >= this.effectiveWindow) {
			state = "critical";
		} else if (tokens >= threshold) {
			state = "error";
		} else if (tokens >= threshold - this.config.warningBuffer) {
			state = "warning";
		} else {
			state = "ok";
		}

		if (state !== this.lastWarningState) {
			this.lastWarningState = state;
			this.config.onWarningStateChange?.(state);
		}

		return state;
	}

	/**
	 * Check if messages should be compacted (auto-compact threshold exceeded).
	 */
	shouldCompact(messages: readonly Message[]): boolean {
		if (this.consecutiveFailures >= this.config.maxConsecutiveFailures) {
			return false; // Circuit breaker tripped
		}
		const tokens = this.estimateTokens(messages);
		return tokens >= this.autoCompactThreshold;
	}

	/**
	 * Perform micro-compaction: trim old tool results without calling the LLM.
	 * This is free (no API call) and can recover significant space.
	 */
	microCompact(messages: readonly Message[]): MicroCompactResult {
		const result = microCompact(
			messages,
			this.config.microCompactKeepRecent,
			this.config.compactableToolNames,
		);

		if (result.toolResultsCleared > 0) {
			this.config.onMicroCompact?.(result);
		}

		return result;
	}

	/**
	 * Perform full compaction: summarize messages using the LLM.
	 *
	 * Requires `summarize` function in config.
	 *
	 * Algorithm:
	 * 1. Estimate current token count
	 * 2. Strip images from messages
	 * 3. Call the LLM to summarize
	 * 4. If summary fails (prompt too long), truncate oldest messages and retry
	 * 5. Return compacted messages (boundary + summary)
	 */
	async compact(
		messages: Message[],
		options?: { customInstructions?: string; continueAutonomously?: boolean },
	): Promise<CompactionResult> {
		if (!this.config.summarize) {
			throw new Error(
				"contextkit: `summarize` function is required for full compaction. " +
					"Pass a function that calls your LLM to summarize messages.",
			);
		}

		if (messages.length === 0) {
			throw new Error("contextkit: No messages to compact.");
		}

		const preCompactTokens = this.estimateTokens(messages);

		// Strip images before summarizing
		const cleanMessages = stripImages(messages);

		// Build the summarization prompt
		const prompt = buildCompactPrompt(options?.customInstructions);

		// Retry loop for prompt-too-long errors
		let messagesToSummarize = cleanMessages;
		let summary: string | undefined;
		const maxRetries = 3;

		for (let attempt = 0; attempt < maxRetries; attempt++) {
			try {
				summary = await this.config.summarize(
					messagesToSummarize,
					prompt,
					{ maxOutputTokens: this.config.summaryMaxTokens },
				);

				if (summary && summary.trim().length > 0) {
					break; // Success
				}
			} catch (err) {
				const message =
					err instanceof Error ? err.message : String(err);

				// If prompt too long, truncate oldest messages and retry
				if (
					message.toLowerCase().includes("too long") ||
					message.toLowerCase().includes("context length") ||
					message.toLowerCase().includes("max tokens")
				) {
					const groups = groupMessagesByRound(messagesToSummarize);
					const dropCount = Math.max(
						1,
						Math.ceil(groups.length * 0.2),
					);
					const remaining = groups.slice(dropCount);
					messagesToSummarize = remaining.flat();

					if (messagesToSummarize.length === 0) {
						throw new Error(
							"contextkit: All messages truncated during retry — conversation too large to summarize.",
						);
					}
					continue;
				}

				// Other errors — fail
				this.consecutiveFailures++;
				throw err;
			}
		}

		if (!summary || summary.trim().length === 0) {
			this.consecutiveFailures++;
			throw new Error("contextkit: Summarization returned empty result.");
		}

		// Success — reset circuit breaker
		this.consecutiveFailures = 0;

		// Build compacted messages
		const formattedSummary = formatCompactedSummary(
			summary,
			options?.continueAutonomously,
		);

		const boundaryMessage: Message = {
			role: "system",
			content: "[Context compacted — summary follows]",
			metadata: {
				contextkit: true,
				compactedAt: Date.now(),
				preCompactTokens,
				messageCount: messages.length,
			},
		};

		const summaryMessage: Message = {
			role: "user",
			content: formattedSummary,
			metadata: { contextkit: true, type: "summary" },
		};

		const compactedMessages = [boundaryMessage, summaryMessage];
		const postCompactTokens = this.estimateTokens(compactedMessages);

		const result: CompactionResult = {
			messages: compactedMessages,
			preCompactTokens,
			postCompactTokens,
			tokensFreed: preCompactTokens - postCompactTokens,
			summary,
			isAutoCompact: false,
		};

		this.config.onAutoCompact?.(result);
		return result;
	}

	/**
	 * Auto-compact if needed. Call this after every LLM response.
	 *
	 * Tries micro-compact first (free), then full compact if still over threshold.
	 * Returns the messages unchanged if no compaction needed.
	 */
	async autoCompact(messages: Message[]): Promise<{
		messages: Message[];
		compacted: boolean;
		result?: CompactionResult | MicroCompactResult;
	}> {
		if (!this.shouldCompact(messages)) {
			return { messages, compacted: false };
		}

		// Tier 1: Try micro-compact first (free)
		const microResult = this.microCompact(messages);
		if (microResult.tokensFreed > 0) {
			const newTokens = this.estimateTokens(microResult.messages);
			if (newTokens < this.autoCompactThreshold) {
				return {
					messages: microResult.messages,
					compacted: true,
					result: microResult,
				};
			}
			// Micro-compact wasn't enough — continue to full compact
			messages = microResult.messages as Message[];
		}

		// Tier 2: Full compact with LLM
		if (!this.config.summarize) {
			// No summarize function — micro-compact is all we can do
			return {
				messages: microResult.messages,
				compacted: microResult.tokensFreed > 0,
				result: microResult.tokensFreed > 0 ? microResult : undefined,
			};
		}

		try {
			const result = await this.compact(messages, {
				continueAutonomously: true,
			});
			result.isAutoCompact = true;
			return { messages: result.messages, compacted: true, result };
		} catch {
			// Failed — return micro-compacted messages if we got any benefit
			return {
				messages: microResult.messages,
				compacted: microResult.tokensFreed > 0,
				result: microResult.tokensFreed > 0 ? microResult : undefined,
			};
		}
	}

	/**
	 * Reset the circuit breaker (e.g., after fixing an issue).
	 */
	resetCircuitBreaker(): void {
		this.consecutiveFailures = 0;
	}

	/**
	 * Get current stats.
	 */
	getStats(): {
		effectiveWindow: number;
		autoCompactThreshold: number;
		consecutiveFailures: number;
		circuitBreakerTripped: boolean;
	} {
		return {
			effectiveWindow: this.effectiveWindow,
			autoCompactThreshold: this.autoCompactThreshold,
			consecutiveFailures: this.consecutiveFailures,
			circuitBreakerTripped:
				this.consecutiveFailures >= this.config.maxConsecutiveFailures,
		};
	}
}

/**
 * Create a new ContextKit instance.
 */
export function createContextKit(config: ContextKitConfig): ContextKit {
	return new ContextKit(config);
}
