import { describe, it, expect, vi } from "vitest";
import { createContextKit } from "../src/compactor/engine.js";
import { microCompact, stripImages } from "../src/compactor/micro.js";
import { buildCompactPrompt, formatCompactedSummary } from "../src/compactor/prompt.js";
import type { Message, SummarizeFn } from "../src/types/index.js";

// --- Test helpers ---

function makeMessages(count: number, charsEach = 200): Message[] {
	return Array.from({ length: count }, (_, i) => ({
		role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
		content: `Message ${i}: ${"x".repeat(charsEach)}`,
	}));
}

function makeToolMessages(): Message[] {
	return [
		{ role: "user", content: "read file" },
		{
			role: "assistant",
			content: [
				{ type: "tool_use" as const, id: "t1", name: "Read", input: { path: "/a.ts" } },
			],
		},
		{
			role: "user",
			content: [
				{ type: "tool_result" as const, toolUseId: "t1", content: "file content A ".repeat(100) },
			],
		},
		{ role: "user", content: "read another" },
		{
			role: "assistant",
			content: [
				{ type: "tool_use" as const, id: "t2", name: "Read", input: { path: "/b.ts" } },
			],
		},
		{
			role: "user",
			content: [
				{ type: "tool_result" as const, toolUseId: "t2", content: "file content B ".repeat(100) },
			],
		},
		{ role: "user", content: "read third" },
		{
			role: "assistant",
			content: [
				{ type: "tool_use" as const, id: "t3", name: "Read", input: { path: "/c.ts" } },
			],
		},
		{
			role: "user",
			content: [
				{ type: "tool_result" as const, toolUseId: "t3", content: "file content C ".repeat(100) },
			],
		},
	];
}

const mockSummarize: SummarizeFn = async (_messages, _prompt) => {
	return "## Summary\nUser asked questions. Assistant answered them. Key files: a.ts, b.ts.";
};

// --- Tests ---

describe("ContextKit", () => {
	it("creates with default config", () => {
		const ctx = createContextKit({ contextWindowSize: 200_000 });
		expect(ctx.effectiveWindow).toBe(200_000 - 20_000);
		expect(ctx.autoCompactThreshold).toBe(200_000 - 20_000 - 13_000);
	});

	it("shouldCompact returns false below threshold", () => {
		const ctx = createContextKit({ contextWindowSize: 200_000 });
		const messages = makeMessages(5); // ~250 tokens
		expect(ctx.shouldCompact(messages)).toBe(false);
	});

	it("shouldCompact returns true above threshold", () => {
		const ctx = createContextKit({
			contextWindowSize: 1000, // tiny window
			maxOutputTokens: 100,
			autoCompactBuffer: 100,
		});
		const messages = makeMessages(50, 500); // many large messages
		expect(ctx.shouldCompact(messages)).toBe(true);
	});

	it("getWarningState tracks states", () => {
		const states: string[] = [];
		const ctx = createContextKit({
			contextWindowSize: 1000,
			maxOutputTokens: 100,
			autoCompactBuffer: 100,
			warningBuffer: 200,
			onWarningStateChange: (state) => states.push(state),
		});

		ctx.getWarningState([{ role: "user", content: "hi" }]);
		expect(states).toEqual([]); // "ok" is the default, no change

		ctx.getWarningState(makeMessages(50, 500));
		expect(states.length).toBeGreaterThan(0);
	});

	it("compact throws without summarize function", async () => {
		const ctx = createContextKit({ contextWindowSize: 200_000 });
		await expect(
			ctx.compact([{ role: "user", content: "hello" }]),
		).rejects.toThrow("summarize");
	});

	it("compact throws with empty messages", async () => {
		const ctx = createContextKit({
			contextWindowSize: 200_000,
			summarize: mockSummarize,
		});
		await expect(ctx.compact([])).rejects.toThrow("No messages");
	});

	it("compact produces summary messages", async () => {
		const ctx = createContextKit({
			contextWindowSize: 200_000,
			summarize: mockSummarize,
		});

		const messages = makeMessages(10);
		const result = await ctx.compact(messages);

		expect(result.messages).toHaveLength(2); // boundary + summary
		expect(result.messages[0]!.role).toBe("system");
		expect(result.messages[1]!.role).toBe("user");
		expect(result.summary).toContain("Summary");
		expect(result.tokensFreed).toBeGreaterThan(0);
		expect(result.preCompactTokens).toBeGreaterThan(result.postCompactTokens);
	});

	it("compact retries on prompt-too-long error", async () => {
		let callCount = 0;
		const retryingSummarize: SummarizeFn = async () => {
			callCount++;
			if (callCount === 1) {
				throw new Error("Request too long for context length");
			}
			return "Retry succeeded summary";
		};

		const ctx = createContextKit({
			contextWindowSize: 200_000,
			summarize: retryingSummarize,
		});

		const messages = makeMessages(20);
		const result = await ctx.compact(messages);
		expect(callCount).toBe(2);
		expect(result.summary).toContain("Retry succeeded");
	});

	it("circuit breaker trips after consecutive failures", async () => {
		const failingSummarize: SummarizeFn = async () => {
			throw new Error("API error");
		};

		const ctx = createContextKit({
			contextWindowSize: 500,
			maxOutputTokens: 50,
			autoCompactBuffer: 50,
			maxConsecutiveFailures: 2,
			summarize: failingSummarize,
		});

		const messages = makeMessages(30, 500);

		// Fail twice
		await expect(ctx.compact(messages)).rejects.toThrow();
		await expect(ctx.compact(messages)).rejects.toThrow();

		// Circuit breaker should now prevent shouldCompact from returning true
		expect(ctx.shouldCompact(messages)).toBe(false);

		// Reset
		ctx.resetCircuitBreaker();
		expect(ctx.getStats().circuitBreakerTripped).toBe(false);
	});

	it("autoCompact tries micro first, then full", async () => {
		const summarizeSpy = vi.fn(mockSummarize);

		const ctx = createContextKit({
			contextWindowSize: 500,
			maxOutputTokens: 50,
			autoCompactBuffer: 50,
			summarize: summarizeSpy,
		});

		const messages = makeMessages(30, 500);
		const result = await ctx.autoCompact(messages);

		expect(result.compacted).toBe(true);
	});

	it("autoCompact returns unchanged when below threshold", async () => {
		const ctx = createContextKit({
			contextWindowSize: 200_000,
			summarize: mockSummarize,
		});

		const messages = makeMessages(3);
		const result = await ctx.autoCompact(messages);

		expect(result.compacted).toBe(false);
		expect(result.messages).toBe(messages);
	});

	it("getStats returns current state", () => {
		const ctx = createContextKit({ contextWindowSize: 100_000 });
		const stats = ctx.getStats();
		expect(stats.effectiveWindow).toBe(100_000 - 20_000);
		expect(stats.consecutiveFailures).toBe(0);
		expect(stats.circuitBreakerTripped).toBe(false);
	});
});

describe("microCompact", () => {
	it("clears old tool results, keeps recent", () => {
		const messages = makeToolMessages();
		const result = microCompact(messages, 1); // keep only 1 recent

		expect(result.toolResultsCleared).toBe(2);
		expect(result.tokensFreed).toBeGreaterThan(0);
	});

	it("returns unchanged if no tool results", () => {
		const messages: Message[] = [
			{ role: "user", content: "hello" },
			{ role: "assistant", content: "hi" },
		];
		const result = microCompact(messages);
		expect(result.toolResultsCleared).toBe(0);
		expect(result.tokensFreed).toBe(0);
	});

	it("respects keepRecent parameter", () => {
		const messages = makeToolMessages(); // 3 tool results
		const result = microCompact(messages, 3); // keep all 3
		expect(result.toolResultsCleared).toBe(0);
	});
});

describe("stripImages", () => {
	it("replaces image blocks with text markers", () => {
		const messages: Message[] = [
			{
				role: "user",
				content: [
					{ type: "text", text: "look at this" },
					{ type: "image", data: "base64data" },
				],
			},
		];
		const result = stripImages(messages);
		const content = result[0]!.content as Array<{ type: string; text?: string }>;
		expect(content[1]!.type).toBe("text");
		expect(content[1]!.text).toContain("removed");
	});

	it("passes through string content unchanged", () => {
		const messages: Message[] = [{ role: "user", content: "hello" }];
		const result = stripImages(messages);
		expect(result[0]!.content).toBe("hello");
	});
});

describe("prompt helpers", () => {
	it("buildCompactPrompt includes all 9 sections", () => {
		const prompt = buildCompactPrompt();
		expect(prompt).toContain("Primary Request");
		expect(prompt).toContain("Key Technical");
		expect(prompt).toContain("Files and Code");
		expect(prompt).toContain("Errors and Fixes");
		expect(prompt).toContain("Problem Solving");
		expect(prompt).toContain("User Messages");
		expect(prompt).toContain("Pending Tasks");
		expect(prompt).toContain("Current Work");
		expect(prompt).toContain("Next Step");
	});

	it("buildCompactPrompt includes custom instructions", () => {
		const prompt = buildCompactPrompt("Focus on database queries");
		expect(prompt).toContain("Focus on database queries");
	});

	it("formatCompactedSummary wraps summary", () => {
		const result = formatCompactedSummary("My summary");
		expect(result).toContain("My summary");
		expect(result).toContain("[Session compacted");
	});

	it("formatCompactedSummary adds autonomous continuation", () => {
		const result = formatCompactedSummary("My summary", true);
		expect(result).toContain("Continue from where you left off");
	});
});
