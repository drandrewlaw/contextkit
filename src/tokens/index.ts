import type { ContentBlock, Message, TokenUsage } from "../types/index.js";

/** Rough estimate: ~2000 tokens per image/document block */
const IMAGE_TOKEN_ESTIMATE = 2000;

/** Safety buffer multiplier (33% overestimate for conservative sizing) */
const ESTIMATION_BUFFER = 1.333;

/**
 * Estimate token count for a string.
 * Default: ~1 token per 4 characters (tuned for English/code mix).
 */
export function estimateTokens(text: string, bytesPerToken = 4): number {
	return Math.ceil(text.length / bytesPerToken);
}

/**
 * Estimate tokens for a single content block.
 */
export function estimateBlockTokens(block: ContentBlock): number {
	switch (block.type) {
		case "text":
			return estimateTokens(block.text);
		case "image":
			return IMAGE_TOKEN_ESTIMATE;
		case "tool_use":
			return estimateTokens(
				`${block.name}:${JSON.stringify(block.input)}`,
			);
		case "tool_result":
			return estimateTokens(block.content);
	}
}

/**
 * Estimate tokens for a single message.
 */
export function estimateMessageTokens(message: Message): number {
	let total = 0;

	if (typeof message.content === "string") {
		total += estimateTokens(message.content);
	} else {
		for (const block of message.content) {
			total += estimateBlockTokens(block);
		}
	}

	// Add tokens for tool calls/results metadata
	if (message.toolCalls) {
		for (const call of message.toolCalls) {
			total += estimateTokens(
				`${call.name}:${JSON.stringify(call.input)}`,
			);
		}
	}
	if (message.toolResults) {
		for (const result of message.toolResults) {
			total += estimateTokens(result.content);
		}
	}

	return total;
}

/**
 * Estimate total tokens for an array of messages.
 * Uses API-reported usage when available, falls back to estimation.
 * Applies a 33% buffer for conservative sizing.
 */
export function estimateConversationTokens(
	messages: readonly Message[],
	customEstimator?: (text: string) => number,
): number {
	// Walk backward to find the last message with API-reported usage
	let lastUsageIndex = -1;
	let lastUsage: TokenUsage | undefined;

	for (let i = messages.length - 1; i >= 0; i--) {
		const msg = messages[i];
		if (msg?.usage) {
			lastUsage = msg.usage;
			lastUsageIndex = i;
			break;
		}
	}

	if (lastUsage && lastUsageIndex >= 0) {
		// Use API-reported tokens for everything up to lastUsageIndex
		const apiTokens =
			lastUsage.totalTokens ??
			lastUsage.inputTokens +
				lastUsage.outputTokens +
				(lastUsage.cacheReadTokens ?? 0) +
				(lastUsage.cacheWriteTokens ?? 0);

		// Estimate tokens for messages after the last API response
		let estimatedTail = 0;
		for (let i = lastUsageIndex + 1; i < messages.length; i++) {
			const msg = messages[i];
			if (msg) {
				estimatedTail += estimateMessageTokens(msg);
			}
		}

		return apiTokens + Math.ceil(estimatedTail * ESTIMATION_BUFFER);
	}

	// No API usage available — estimate everything
	const estimate = customEstimator ?? estimateTokens;
	let total = 0;
	for (const message of messages) {
		if (typeof message.content === "string") {
			total += estimate(message.content);
		} else {
			total += estimateMessageTokens(message);
		}
	}

	return Math.ceil(total * ESTIMATION_BUFFER);
}

/**
 * Group messages by API round-trip (user prompt → assistant response → tool results).
 * Used for intelligent truncation during compaction.
 */
export function groupMessagesByRound(
	messages: readonly Message[],
): Message[][] {
	const groups: Message[][] = [];
	let current: Message[] = [];

	for (const message of messages) {
		if (message.role === "user" && current.length > 0) {
			groups.push(current);
			current = [];
		}
		current.push(message);
	}

	if (current.length > 0) {
		groups.push(current);
	}

	return groups;
}
