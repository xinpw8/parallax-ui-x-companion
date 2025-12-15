# Parallax UI + Vast.ai Setup Notes

## Current Configuration

**Local `.env` file:**
```bash
VITE_API_BACKEND=parallax
VITE_PARALLAX_ENDPOINT=http://localhost:3002/v1/chat/completions
VITE_PARALLAX_MODEL=Qwen/Qwen2.5-7B-Instruct

# Groq fallback
VITE_GROQ_API_KEY=your_groq_api_key_here
```

## Vast.ai Instance Setup

**1. Rent GPU instance** (RTX 3090/4090 or similar with enough VRAM for 7B model)

**2. SSH into instance and run inference server:**
```bash
# Install vLLM (if not already installed)
pip install vllm

# Start the server on port 8000 (or whichever port you use)
python -m vllm.entrypoints.openai.api_server \
  --model Qwen/Qwen2.5-7B-Instruct \
  --host 0.0.0.0 \
  --port 8000
```

**3. Create SSH tunnel from your Windows machine:**
```bash
ssh -L 3002:localhost:8000 -p <VAST_SSH_PORT> root@<VAST_IP>
```
This forwards `localhost:3002` on Windows to port 8000 on vast.ai

## Starting the Electron App (Windows)

```bash
cd C:\Users\Daniel\parallax-ui
npm run electron:dev
```

## Quick Restart Checklist

1. Start vast.ai instance
2. SSH in and start vLLM server
3. Open SSH tunnel (`ssh -L 3002:localhost:8000 ...`)
4. Run `npm run electron:dev`

## Fallback to Groq

If vast.ai is down, edit `.env`:
```bash
VITE_API_BACKEND=groq
```
Then restart the app.

## Troubleshooting

### Electron won't start / cache errors
Kill any lingering Electron processes:
```powershell
Stop-Process -Name electron -Force -ErrorAction SilentlyContinue
```

### Port 5173 in use
Vite will auto-switch to 5174. Or kill the process using the port:
```powershell
netstat -ano | findstr :5173
taskkill /PID <PID> /F
```
