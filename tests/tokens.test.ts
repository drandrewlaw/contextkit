import { describe, it, expect } from "vitest";
import {
	estimateTokens,
	estimateMessageTokens,
	estimateConversationTokens,
	groupMessagesByRound,
} from "../src/tokens/index.js";
import type { Message } from "../src/types/index.js";

describe("estimateTokens", () => {
	it("estimates ~1 token per 4 chars", () => {
		expect(estimateTokens("hello world")).toBe(3); // 11 chars / 4
	});

	it("handles empty string", () => {
		expect(estimateTokens("")).toBe(0);
	});

	it("handles long text", () => {
		const text = "a".repeat(1000);
		expect(estimateTokens(text)).toBe(250);
	});
});

describe("estimateMessageTokens", () => {
	it("estimates string content", () => {
		const msg: Message = { role: "user", content: "hello world" };
		expect(estimateMessageTokens(msg)).toBe(3);
	});

	it("estimates content blocks", () => {
		const msg: Message = {
			role: "assistant",
			content: [
				{ type: "text", text: "hello" },
				{ type: "text", text: "world" },
			],
		};
		expect(estimateMessageTokens(msg)).toBeGreaterThan(0);
	});

	it("estimates image blocks as ~2000 tokens", () => {
		const msg: Message = {
			role: "user",
			content: [{ type: "image", data: "base64..." }],
		};
		expect(estimateMessageTokens(msg)).toBe(2000);
	});

	it("estimates tool calls", () => {
		const msg: Message = {
			role: "assistant",
			content: "calling tool",
			toolCalls: [{ id: "1", name: "Bash", input: { command: "ls" } }],
		};
		expect(estimateMessageTokens(msg)).toBeGreaterThan(3);
	});
});

describe("estimateConversationTokens", () => {
	it("uses API usage when available", () => {
		const messages: Message[] = [
			{ role: "user", content: "hello" },
			{
				role: "assistant",
				content: "hi",
				usage: { inputTokens: 100, outputTokens: 50 },
			},
		];
		expect(estimateConversationTokens(messages)).toBe(150);
	});

	it("adds estimation for messages after API usage", () => {
		const messages: Message[] = [
			{ role: "user", content: "hello" },
			{
				role: "assistant",
				content: "hi",
				usage: { inputTokens: 100, outputTokens: 50 },
			},
			{ role: "user", content: "how are you doing today?" },
		];
		const tokens = estimateConversationTokens(messages);
		expect(tokens).toBeGreaterThan(150);
	});

	it("falls back to pure estimation with no usage", () => {
		const messages: Message[] = [
			{ role: "user", content: "hello" },
			{ role: "assistant", content: "hi there" },
		];
		const tokens = estimateConversationTokens(messages);
		expect(tokens).toBeGreaterThan(0);
	});

	it("applies buffer multiplier for estimation", () => {
		const messages: Message[] = [
			{ role: "user", content: "a".repeat(400) },
		];
		const tokens = estimateConversationTokens(messages);
		// 400/4 = 100 * 1.333 = ~134
		expect(tokens).toBeGreaterThan(100);
	});
});

describe("groupMessagesByRound", () => {
	it("groups user→assistant pairs", () => {
		const messages: Message[] = [
			{ role: "user", content: "hello" },
			{ role: "assistant", content: "hi" },
			{ role: "user", content: "bye" },
			{ role: "assistant", content: "goodbye" },
		];
		const groups = groupMessagesByRound(messages);
		expect(groups).toHaveLength(2);
		expect(groups[0]).toHaveLength(2);
		expect(groups[1]).toHaveLength(2);
	});

	it("handles single message", () => {
		const messages: Message[] = [{ role: "user", content: "hello" }];
		const groups = groupMessagesByRound(messages);
		expect(groups).toHaveLength(1);
	});

	it("handles system messages in groups", () => {
		const messages: Message[] = [
			{ role: "system", content: "you are helpful" },
			{ role: "user", content: "hello" },
			{ role: "assistant", content: "hi" },
		];
		const groups = groupMessagesByRound(messages);
		expect(groups).toHaveLength(2);
	});
});
