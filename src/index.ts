// Core
export { ContextKit, createContextKit } from "./compactor/engine.js";

// Token estimation
export {
	estimateTokens,
	estimateBlockTokens,
	estimateMessageTokens,
	estimateConversationTokens,
	groupMessagesByRound,
} from "./tokens/index.js";

// Micro-compaction
export { microCompact, stripImages } from "./compactor/micro.js";

// Prompts
export {
	DEFAULT_SUMMARY_PROMPT,
	buildCompactPrompt,
	formatCompactedSummary,
} from "./compactor/prompt.js";

// Types
export type {
	Message,
	ContentBlock,
	ToolCall,
	ToolResult,
	TokenUsage,
	SummarizeFn,
	SummarizeOptions,
	CompactionResult,
	MicroCompactResult,
	ContextWarningState,
	ContextKitConfig,
} from "./types/index.js";
