/**
 * Default summarization prompt extracted from Claude Code's 9-section format.
 * Provider-agnostic — works with any LLM that can follow instructions.
 */

export const DEFAULT_SUMMARY_PROMPT = `You are summarizing a conversation between a user and an AI assistant. Your summary will REPLACE the conversation history, so it must capture everything needed to continue seamlessly.

Produce a structured summary with these sections:

## 1. Primary Request and Intent
What is the user trying to accomplish? Include the original request and any refinements.

## 2. Key Technical Concepts
Important technical details, constraints, or domain knowledge established during the conversation.

## 3. Files and Code Sections
List every file read, modified, or discussed. Include relevant code snippets that would be needed to continue the work. Be specific — include actual function names, variable names, and line numbers when discussed.

## 4. Errors and Fixes
Any errors encountered and how they were resolved. Include the error messages and the fixes applied.

## 5. Problem Solving
Key decisions made, approaches tried, and reasoning for the chosen approach.

## 6. User Messages
Summarize every user message — their exact requests, preferences, corrections, and feedback. Do not lose any user intent.

## 7. Pending Tasks
Anything explicitly or implicitly left to do. Include partial progress.

## 8. Current Work
The precise state of work right now. What file is open? What function was being written? What test was failing? Be specific enough that work can resume without any "what was I doing?" confusion.

## 9. Next Step
What should happen next? Base this on the user's most recent requests. Include direct quotes from the user where relevant.

IMPORTANT:
- Include actual code snippets, file paths, and specific details — not just summaries of summaries
- Preserve every user decision and preference
- If the user corrected the assistant, capture that correction
- Do NOT add commentary or analysis — just capture the facts`;

/**
 * Build the full compaction prompt with optional custom instructions.
 */
export function buildCompactPrompt(customInstructions?: string): string {
	let prompt = DEFAULT_SUMMARY_PROMPT;

	if (customInstructions) {
		prompt += `\n\nAdditional instructions from the user:\n${customInstructions}`;
	}

	prompt +=
		"\n\nNow summarize the conversation above. Be thorough — this summary replaces the full history.";

	return prompt;
}

/**
 * Format the compaction result as a system message.
 */
export function formatCompactedSummary(
	summary: string,
	continueAutonomously = false,
): string {
	let result = `[Session compacted — previous context summarized below]\n\n${summary}`;

	if (continueAutonomously) {
		result +=
			"\n\n[Continue from where you left off without asking questions. The full conversation history has been summarized above.]";
	}

	return result;
}
