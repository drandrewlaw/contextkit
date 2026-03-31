/**
 * A message in the conversation. Provider-agnostic format.
 */
export type Message = {
	role: "user" | "assistant" | "system";
	content: string | ContentBlock[];
	/** Unique message ID for tracking */
	id?: string;
	/** Token usage from the API response (if available) */
	usage?: TokenUsage;
	/** Timestamp of the message */
	timestamp?: number;
	/** Tool call metadata */
	toolCalls?: ToolCall[];
	/** Tool result metadata */
	toolResults?: ToolResult[];
	/** Arbitrary metadata */
	metadata?: Record<string, unknown>;
};

export type ContentBlock =
	| { type: "text"; text: string }
	| { type: "image"; data: string }
	| { type: "tool_use"; id: string; name: string; input: unknown }
	| { type: "tool_result"; toolUseId: string; content: string };

export type ToolCall = {
	id: string;
	name: string;
	input: unknown;
};

export type ToolResult = {
	toolUseId: string;
	content: string;
};

/**
 * Token usage reported by the LLM API.
 */
export type TokenUsage = {
	inputTokens: number;
	outputTokens: number;
	cacheReadTokens?: number;
	cacheWriteTokens?: number;
	totalTokens?: number;
};

/**
 * A function that calls an LLM to summarize messages.
 * This is the provider abstraction — implement for Claude, OpenAI, Gemini, etc.
 */
export type SummarizeFn = (
	messages: Message[],
	prompt: string,
	options?: SummarizeOptions,
) => Promise<string>;

export type SummarizeOptions = {
	maxOutputTokens?: number;
	signal?: AbortSignal;
};

/**
 * Result of a compaction operation.
 */
export type CompactionResult = {
	/** The compacted messages (boundary + summary + preserved) */
	messages: Message[];
	/** Token count before compaction */
	preCompactTokens: number;
	/** Token count after compaction */
	postCompactTokens: number;
	/** Tokens freed */
	tokensFreed: number;
	/** The summary text generated */
	summary: string;
	/** Whether this was an auto-triggered compaction */
	isAutoCompact: boolean;
};

/**
 * Result of a micro-compaction (no LLM call needed).
 */
export type MicroCompactResult = {
	/** Messages with old tool results trimmed */
	messages: Message[];
	/** Number of tool results cleared */
	toolResultsCleared: number;
	/** Estimated tokens freed */
	tokensFreed: number;
};

/**
 * Warning states for context window usage.
 */
export type ContextWarningState = "ok" | "warning" | "error" | "critical";

/**
 * Configuration for the context manager.
 */
export type ContextKitConfig = {
	/** Total context window size in tokens (e.g., 200000 for Claude, 128000 for GPT-4) */
	contextWindowSize: number;

	/** Max output tokens the model can generate (default: 32000) */
	maxOutputTokens?: number;

	/** Buffer tokens before triggering auto-compact (default: 13000) */
	autoCompactBuffer?: number;

	/** Buffer tokens for warning state (default: 20000) */
	warningBuffer?: number;

	/** Max consecutive auto-compact failures before circuit break (default: 3) */
	maxConsecutiveFailures?: number;

	/** Max output tokens allocated for the summary (default: 20000) */
	summaryMaxTokens?: number;

	/** Custom token estimation function. Default: ~1 token per 4 chars */
	estimateTokens?: (text: string) => number;

	/** The LLM summarization function (required for full compaction) */
	summarize?: SummarizeFn;

	/** Custom summarization prompt template */
	summaryPrompt?: string;

	/**
	 * Which message roles' tool results can be cleared during micro-compaction.
	 * Default: tool results in 'user' role messages.
	 */
	compactableToolNames?: string[];

	/** Keep this many recent tool results during micro-compact (default: 5) */
	microCompactKeepRecent?: number;

	/** Called when auto-compact triggers */
	onAutoCompact?: (result: CompactionResult) => void;

	/** Called when micro-compact triggers */
	onMicroCompact?: (result: MicroCompactResult) => void;

	/** Called when context warning state changes */
	onWarningStateChange?: (state: ContextWarningState) => void;
};
