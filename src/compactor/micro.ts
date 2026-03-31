import type {
	ContentBlock,
	Message,
	MicroCompactResult,
} from "../types/index.js";
import { estimateTokens } from "../tokens/index.js";

const CLEARED_MESSAGE = "[Old tool result cleared to free context space]";

/**
 * Micro-compaction: trim old tool results WITHOUT calling the LLM.
 *
 * This is the cheapest compaction tier — it simply replaces old tool_result
 * content blocks with a placeholder, keeping only the most recent N results.
 *
 * @param messages - Conversation messages
 * @param keepRecent - Number of recent tool results to keep (default: 5)
 * @param compactableToolNames - Tool names eligible for clearing (optional, all if omitted)
 */
export function microCompact(
	messages: readonly Message[],
	keepRecent = 5,
	compactableToolNames?: string[],
): MicroCompactResult {
	// Collect all tool result positions
	const toolResultPositions: Array<{
		messageIndex: number;
		blockIndex: number;
		toolName: string;
		tokenEstimate: number;
	}> = [];

	for (let mi = 0; mi < messages.length; mi++) {
		const msg = messages[mi]!;
		if (typeof msg.content === "string") continue;

		for (let bi = 0; bi < msg.content.length; bi++) {
			const block = msg.content[bi]!;
			if (block.type !== "tool_result") continue;

			// Find the corresponding tool_use to get the tool name
			const toolName = findToolName(messages, block.toolUseId, mi);
			if (
				compactableToolNames &&
				toolName &&
				!compactableToolNames.includes(toolName)
			) {
				continue;
			}

			toolResultPositions.push({
				messageIndex: mi,
				blockIndex: bi,
				toolName: toolName ?? "unknown",
				tokenEstimate: estimateTokens(block.content),
			});
		}
	}

	// Keep only the most recent N, clear the rest
	const toClear = toolResultPositions.slice(
		0,
		Math.max(0, toolResultPositions.length - keepRecent),
	);

	if (toClear.length === 0) {
		return { messages: [...messages], toolResultsCleared: 0, tokensFreed: 0 };
	}

	// Build a set of positions to clear
	const clearSet = new Set(
		toClear.map((p) => `${p.messageIndex}:${p.blockIndex}`),
	);
	let tokensFreed = 0;

	const newMessages = messages.map((msg, mi) => {
		if (typeof msg.content === "string") return { ...msg };

		const newContent: ContentBlock[] = msg.content.map((block, bi) => {
			const key = `${mi}:${bi}`;
			if (clearSet.has(key) && block.type === "tool_result") {
				tokensFreed += estimateTokens(block.content);
				return { ...block, content: CLEARED_MESSAGE };
			}
			return block;
		});

		return { ...msg, content: newContent };
	});

	return {
		messages: newMessages,
		toolResultsCleared: toClear.length,
		tokensFreed,
	};
}

/**
 * Strip image/document blocks from messages (replace with text markers).
 * Useful before sending to the summarizer to avoid hitting input limits.
 */
export function stripImages(messages: readonly Message[]): Message[] {
	return messages.map((msg) => {
		if (typeof msg.content === "string") return { ...msg };

		const newContent: ContentBlock[] = msg.content.map((block) => {
			if (block.type === "image") {
				return { type: "text" as const, text: "[image removed for compaction]" };
			}
			return block;
		});

		return { ...msg, content: newContent };
	});
}

function findToolName(
	messages: readonly Message[],
	toolUseId: string,
	beforeIndex: number,
): string | undefined {
	for (let i = beforeIndex; i >= 0; i--) {
		const msg = messages[i]!;
		if (typeof msg.content === "string") continue;
		for (const block of msg.content) {
			if (block.type === "tool_use" && block.id === toolUseId) {
				return block.name;
			}
		}
		// Also check toolCalls metadata
		if (msg.toolCalls) {
			for (const call of msg.toolCalls) {
				if (call.id === toolUseId) return call.name;
			}
		}
	}
	return undefined;
}
