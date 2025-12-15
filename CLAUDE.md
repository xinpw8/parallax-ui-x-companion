# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---
**CRITICAL - READ THIS FIRST:**
1. **This dev environment runs in WSL but the Electron app runs on WINDOWS**
2. **After EVERY file edit, copy changes to Windows:**
   ```bash
   cp /home/daa/parallax/parallax-ui/<file> /mnt/c/Users/Daniel/parallax-ui/<file>
   ```
3. **Always include Windows (`win32`) support in platform-specific code**

---

> **Note:** If working directly on Windows (not WSL), skip the file copy step above.

## Project Overview

Parallax UI is an AI-powered X/Twitter companion desktop application built with Electron + React + Vite. It embeds X.com in a webview and provides AI-generated reply suggestions when hovering over tweets while holding Ctrl.

## Development Commands

```bash
npm run dev              # Start Vite dev server (web only)
npm run electron:dev     # Start full Electron app with hot reload
npm run build           # TypeScript check + Vite production build
npm run lint            # Run ESLint
npm run electron        # Run Electron with built files
```

## Architecture

### Dual-Process Electron Architecture

**Main Process** (`electron/main.cjs`):
- Creates BrowserWindow with webview support enabled
- Handles IPC for clipboard operations (image/text read/write)
- Sets up application menu with custom paste handling

**Preload** (`electron/preload.cjs`):
- Exposes `electronAPI` to renderer via contextBridge
- Provides clipboard APIs, paste triggers, and tweet analysis IPC

**Renderer** (`src/App.tsx`):
- Single-file React app containing all UI logic
- Embeds X.com in a `<webview>` tag with persistent session
- Injects JavaScript into webview to track Ctrl key state and hovered tweets
- Polls webview state every 50ms to detect tweet hover + Ctrl press
- Generates reply suggestions in 4 styles via LLM API (Groq or local Parallax)
- Handles clipboard image paste into tweet composer

### Key Interaction Flow

1. User holds Ctrl and hovers over a tweet in the webview
2. Injected JS tracks `hoveredTweetText` and mouse position
3. React polls this state and triggers `generateReplies()` for new tweets
4. Panel shows 4 AI-generated reply options (laconic, excited, flippant, supportive)
5. Clicking a reply calls `window.insertReply()` in webview to post it

### API Backend Configuration

Set via environment variables (see `.env.example`):
- `VITE_API_BACKEND`: `'groq'` (default) or `'parallax'`
- `VITE_GROQ_API_KEY`: API key for Groq cloud
- `VITE_PARALLAX_ENDPOINT`: URL for local Parallax inference server
- `VITE_PARALLAX_MODEL`: Model name for local inference

### Vite Proxy Configuration

Dev server proxies `/v1`, `/api`, `/cluster` routes to `localhost:3001` for local backend development.

## Tech Stack

- React 19 with TypeScript
- Tailwind CSS v4 (via `@tailwindcss/vite` plugin)
- Framer Motion for animations
- Electron 39 with webview tag support
- ESLint with flat config (eslint.config.js)

## Special Features

- **Chat Export**: Ctrl+Shift+E exports DM chat history to clipboard
- **Image Paste**: Ctrl+V with image in clipboard pastes into tweet composer
- **Reply Styles**: Each style has specific prompt engineering in `STYLE_RULES`
- **URL Bar**: Navigation bar at top with back/forward/reload buttons

## Known Issues & Fixes

**Video rendering in webview**: Videos in Electron webviews on Windows can render as blank boxes (0x0 bounding rect) even when video data is loaded. The fix is CSS that forces GPU compositor layers:
```css
video {
  will-change: transform !important;
  transform: translateZ(0) !important;
}
```

## Debugging

Debug logs are written to `debug_logs/` directory with timestamped filenames. Use `window.electronAPI.debugLog(message)` from renderer to log to this file.
