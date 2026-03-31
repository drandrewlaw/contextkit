# contextkit

**Never hit context window limits again.**

[![npm version](https://img.shields.io/npm/v/contextkit.svg)](https://www.npmjs.com/package/contextkit)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue.svg)](https://www.typescriptlang.org/)

Intelligent conversation compaction for LLM applications. When your conversation history exceeds the context window, contextkit automatically summarizes old messages while preserving critical context — so your agent keeps working seamlessly.

Extracted from battle-tested patterns powering production AI systems serving millions of users.

![contextkit demo](demo.gif)

*Conversation grows to 100% of context window, then auto-compacts back to 10% — seamlessly.*

## The Problem

Every LLM app hits this wall:

```
Error: This request would exceed the model's context window (200,000 tokens).
```

Current solutions are terrible:
- **Truncate oldest messages** → Agent forgets what it was doing
- **Sliding window** → Same amnesia problem
- **Crash/restart** → User loses all progress
- **Hope conversations stay short** → They never do

## The Solution

contextkit uses a **3-tier compaction strategy** extracted from production AI systems:

1. **Micro-compact** (free) — Trim old tool results without calling the LLM
2. **Auto-compact** (smart) — Summarize old messages when approaching the limit
3. **Circuit breaker** — Stop retrying after consecutive failures

## Install

```bash
npm install contextkit
```

**Zero dependencies.** Works with any LLM provider.

## Quick Start

```typescript
import { createContextKit } from 'contextkit'

const ctx = createContextKit({
  contextWindowSize: 200_000,  // Your model's context window

  // Plug in ANY LLM as the summarizer
  summarize: async (messages, prompt) => {
    const resp = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        ...messages.map(m => ({ role: m.role, content: m.content as string })),
        { role: 'user', content: prompt },
      ],
    })
    return resp.choices[0].message.content
  },
})

// After every LLM response, check if compaction is needed:
const { messages, compacted } = await ctx.autoCompact(conversationHistory)
if (compacted) {
  conversationHistory = messages  // Seamlessly replaced
}
```

## Provider Examples

### OpenAI / GPT-4

```typescript
const ctx = createContextKit({
  contextWindowSize: 128_000,
  summarize: async (messages, prompt) => {
    const resp = await openai.chat.completions.create({
      model: 'gpt-4o-mini',  // Use a cheap model for summarization
      messages: [
        ...messages.map(m => ({ role: m.role, content: m.content as string })),
        { role: 'user', content: prompt },
      ],
      max_tokens: 20_000,
    })
    return resp.choices[0].message.content ?? ''
  },
})
```

### Anthropic / Claude

```typescript
const ctx = createContextKit({
  contextWindowSize: 200_000,
  summarize: async (messages, prompt) => {
    const resp = await anthropic.messages.create({
      model: 'claude-haiku-4-5',  // Use Haiku for cheap summarization
      max_tokens: 20_000,
      messages: [
        ...messages.map(m => ({ role: m.role as 'user' | 'assistant', content: m.content as string })),
        { role: 'user', content: prompt },
      ],
    })
    return resp.content[0].type === 'text' ? resp.content[0].text : ''
  },
})
```

### Google Gemini

```typescript
const ctx = createContextKit({
  contextWindowSize: 1_000_000,  // Gemini's 1M context
  summarize: async (messages, prompt) => {
    const chat = model.startChat({ history: messages.map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content as string }],
    }))})
    const result = await chat.sendMessage(prompt)
    return result.response.text()
  },
})
```

### Local Models (Ollama)

```typescript
const ctx = createContextKit({
  contextWindowSize: 8_000,  // Smaller window = compaction even more important
  summarize: async (messages, prompt) => {
    const resp = await fetch('http://localhost:11434/api/chat', {
      method: 'POST',
      body: JSON.stringify({
        model: 'llama3',
        messages: [
          ...messages.map(m => ({ role: m.role, content: m.content })),
          { role: 'user', content: prompt },
        ],
      }),
    })
    const data = await resp.json()
    return data.message.content
  },
})
```

## API Reference

### `createContextKit(config)`

| Config | Type | Default | Description |
|--------|------|---------|-------------|
| `contextWindowSize` | `number` | **required** | Model's context window in tokens |
| `summarize` | `SummarizeFn` | — | LLM function for full compaction |
| `maxOutputTokens` | `number` | 32000 | Max output tokens for the model |
| `autoCompactBuffer` | `number` | 13000 | Buffer before auto-compact triggers |
| `warningBuffer` | `number` | 20000 | Buffer for warning state |
| `maxConsecutiveFailures` | `number` | 3 | Circuit breaker threshold |
| `summaryMaxTokens` | `number` | 20000 | Max tokens for the summary |
| `microCompactKeepRecent` | `number` | 5 | Recent tool results to keep |
| `estimateTokens` | `(text: string) => number` | ~1 tok/4 chars | Custom token estimator |
| `onAutoCompact` | `(result) => void` | — | Callback on compaction |
| `onWarningStateChange` | `(state) => void` | — | Callback on warning change |

### Methods

| Method | Description |
|--------|-------------|
| `autoCompact(messages)` | Auto-detect and compact if needed. Call after every LLM response. |
| `compact(messages, options?)` | Force full compaction with LLM summarization. |
| `microCompact(messages)` | Free compaction: trim old tool results, no LLM call. |
| `shouldCompact(messages)` | Check if messages exceed the auto-compact threshold. |
| `estimateTokens(messages)` | Estimate token count for messages. |
| `getWarningState(messages)` | Get context warning state: `ok` / `warning` / `error` / `critical` |
| `getStats()` | Get current engine stats (thresholds, circuit breaker state). |

### Standalone Utilities

```typescript
import {
  estimateTokens,           // Estimate tokens for a string
  estimateMessageTokens,    // Estimate tokens for a message
  estimateConversationTokens, // Estimate tokens for full conversation
  groupMessagesByRound,     // Group messages by API round-trip
  microCompact,             // Standalone micro-compaction
  stripImages,              // Remove images from messages
  buildCompactPrompt,       // Build the summarization prompt
} from 'contextkit'
```

## How It Works

### Token Estimation

contextkit uses a hybrid approach:
- **API-reported tokens** when available (100% accurate)
- **Character-based estimation** as fallback (~1 token per 4 chars, with 33% safety buffer)

### The 9-Section Summary Prompt

When compacting, contextkit instructs the LLM to produce a structured summary covering:

1. **Primary Request and Intent** — What the user wants
2. **Key Technical Concepts** — Domain knowledge established
3. **Files and Code Sections** — Specific files, functions, code snippets
4. **Errors and Fixes** — Problems encountered and solutions
5. **Problem Solving** — Decisions made and reasoning
6. **User Messages** — Every user request and correction
7. **Pending Tasks** — Work still to do
8. **Current Work** — Exact state right now
9. **Next Step** — What should happen next

This produces summaries that preserve enough context for seamless continuation.

### Auto-Compact Flow

```
After every LLM response:
  │
  ├─ estimateTokens(messages) < threshold? → do nothing
  │
  ├─ Try micro-compact (free) → enough space freed? → done
  │
  ├─ Try full compact (LLM call) → success? → done
  │   └─ Prompt too long? → truncate oldest rounds, retry (max 3x)
  │
  └─ All failed → circuit breaker increments
      └─ 3 consecutive failures → stop trying until reset
```

## Dependencies

**Zero runtime dependencies.** 4.8KB gzipped.

## License

[MIT](./LICENSE)
