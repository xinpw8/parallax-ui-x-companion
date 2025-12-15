# Parallax X Companion

Smart tweet reply generator for X/Twitter. Ctrl+hover over any tweet, pick a reply style, click to auto-post.

## How It Works

1. **Ctrl+hover** over any tweet - highlights it and opens the reply panel
2. **Pick a style** - laconic, excited, flippant, or supportive
3. **Click to post** - auto-inserts the reply and submits it
4. **Release Ctrl** - dismisses the panel

## Features

- **4 Reply Styles** - laconic (terse), excited, flippant (sarcastic), supportive
- **Natural Tone** - no em dashes, all lowercase, sounds human
- **Custom Prompts** - type adjustments like "more sarcastic" and regenerate
- **Dual Backend Support** - use Parallax backend or Groq API fallback
- **One-Click Post** - click any reply to auto-insert and submit

## Quick Start

### 1. Configure API Backend

```bash
cp .env.example .env
```

Edit `.env` to configure your backend:

**Option A: Groq API (default)**
```env
VITE_API_BACKEND=groq
VITE_GROQ_API_KEY=your_groq_api_key_here
```
Get your API key at [console.groq.com](https://console.groq.com)

**Option B: Parallax Backend**
```env
VITE_API_BACKEND=parallax
VITE_PARALLAX_ENDPOINT=http://localhost:8000/v1/chat/completions
VITE_PARALLAX_MODEL=default
```

### 2. Run the App

```bash
npm install
npm run electron:dev
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `VITE_API_BACKEND` | API backend to use: `groq` or `parallax` | `groq` |
| `VITE_GROQ_API_KEY` | Groq API key (required for Groq backend) | - |
| `VITE_PARALLAX_ENDPOINT` | Parallax API endpoint | `http://localhost:8000/v1/chat/completions` |
| `VITE_PARALLAX_MODEL` | Model to use with Parallax backend | `default` |

## Tech Stack

- Electron + React 19 + TypeScript
- Tailwind CSS v4
- Framer Motion
- Vite
- Groq API or Parallax Backend

## Development

```bash
npm run dev              # Vite dev server only
npm run electron:dev     # Full Electron + Vite dev
npm run build            # Production build
npm run lint             # ESLint
```

## Notes

- Run on **Windows natively** for clipboard image paste support (WSL2 doesn't share image clipboard)
- The app uses a persistent session (`persist:x`) so you stay logged into X
