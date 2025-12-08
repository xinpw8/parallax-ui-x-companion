# Parallax X Companion

AI-powered tweet reply generator for X/Twitter. Ctrl+hover over any tweet, pick a reply style, click to auto-post.

## How It Works

1. **Ctrl+hover** over any tweet - highlights it and opens the reply panel
2. **Pick a style** - laconic, excited, flippant, or supportive
3. **Click to post** - auto-inserts the reply and submits it
4. **Release Ctrl** - dismisses the panel

## Features

- **4 Reply Styles** - laconic (terse), excited, flippant (sarcastic), supportive
- **Anti-AI Detection** - no em dashes, no LLM-isms, all lowercase, natural tone
- **Custom Prompts** - type adjustments like "more sarcastic" and regenerate
- **Local-First** - uses Parallax on localhost:3001, falls back to Groq if unavailable
- **One-Click Post** - click any reply to auto-insert and submit

## Quick Start

### 1. Start Parallax (optional, will fall back to Groq)

```bash
parallax run -m Qwen/Qwen3-0.6B
```

### 2. Set up Groq fallback (optional)

```bash
cp .env.example .env
# Edit .env and add your Groq API key
```

### 3. Run the App

```bash
npm install
npm run electron:dev
```

## Tech Stack

- Electron + React 19 + TypeScript
- Tailwind CSS v4
- Framer Motion
- Vite
