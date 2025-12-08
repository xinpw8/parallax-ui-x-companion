import { useState, useEffect, useRef, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { RefreshCw } from 'lucide-react'

interface ReplyOption {
    style: string
    label: string
    reply: string | null
    loading: boolean
}

interface HoveredTweet {
    id: string
    text: string
    x: number
    y: number
}

// Parallax chat client connected to backend on port 3001
// Automatically falls back to Groq if Parallax times out
const PARALLAX_ENDPOINT = 'http://localhost:3001/v1/chat/completions'
const GROQ_ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions'
const GROQ_API_KEY = import.meta.env.VITE_GROQ_API_KEY || ''
const PARALLAX_MODEL = 'Qwen/Qwen3-0.6B'
const GROQ_MODEL = 'llama-3.1-8b-instant'
// Timeout for Parallax requests before falling back to Groq (ms)
const PARALLAX_TIMEOUT = 8000

// Helper to make request with timeout
async function fetchWithTimeout(url: string, options: RequestInit, timeout: number): Promise<Response> {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), timeout)
    try {
        const response = await fetch(url, { ...options, signal: controller.signal })
        clearTimeout(timeoutId)
        return response
    } catch (error) {
        clearTimeout(timeoutId)
        throw error
    }
}

const REPLY_STYLES = [
    { style: 'laconic', label: 'laconic', prompt: 'Be extremely brief and terse. Maximum 10 words. Dry, understated, minimal.' },
    { style: 'excited', label: 'excited', prompt: 'Be genuinely enthusiastic and energetic. Show real excitement about what they said.' },
    { style: 'flippant', label: 'flippant', prompt: 'Be casually dismissive or irreverent. Treat the topic lightly, maybe sarcastically.' },
    { style: 'supportive', label: 'supportive', prompt: 'Be warm and encouraging. Validate their point and add genuine support.' },
]

const ANTI_AI_RULES = `
CRITICAL RULES - VIOLATIONS WILL BE REJECTED:
- NEVER use em dashes (—) under any circumstances
- NEVER ask questions to "elicit engagement" or prompt responses
- NEVER use phrases like "this is so", "I love this", "absolutely", "literally"
- NEVER say "atcha", "gotcha", "ya", "get it", or other LLM-isms
- NEVER start with "I"
- NEVER use corporate speak or buzzwords
- Sound like a real human typing quickly on their phone
- Use casual internet spelling/grammar when natural
- Can use "lol", "lmao", "ngl", "tbh" sparingly if it fits
`

function App() {
    const [hoveredTweet, setHoveredTweet] = useState<HoveredTweet | null>(null)
    const [replies, setReplies] = useState<ReplyOption[]>([])
    const [isCtrlPressed, setIsCtrlPressed] = useState(false)
    const [copiedStyle, setCopiedStyle] = useState<string | null>(null)
    const [webviewReady, setWebviewReady] = useState(false)
    const [isOverPanel, setIsOverPanel] = useState(false)
    const [customPrompt, setCustomPrompt] = useState('')
    const [isRegenerating, setIsRegenerating] = useState(false)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const webviewRef = useRef<any>(null)
    const webviewInitializedRef = useRef(false)
    const generatingForRef = useRef<string | null>(null)
    const lastTextRef = useRef<string | null>(null)
    const ctrlPressedRef = useRef(false)
    const isOverPanelRef = useRef(false)
    const hoveredTweetRef = useRef<HoveredTweet | null>(null)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const generateRepliesRef = useRef<any>(null)
    const webviewReadyRef = useRef(false)

    // Keep refs in sync
    isOverPanelRef.current = isOverPanel
    hoveredTweetRef.current = hoveredTweet
    webviewReadyRef.current = webviewReady

    const generateReplies = useCallback(async (tweetText: string, extraInstruction?: string) => {
        const cacheKey = tweetText + (extraInstruction || '')
        if (!extraInstruction && generatingForRef.current === cacheKey) return
        generatingForRef.current = cacheKey

        setReplies(REPLY_STYLES.map(s => ({
            style: s.style,
            label: s.label,
            reply: null,
            loading: true
        })))

        const promises = REPLY_STYLES.map(async (styleInfo, index) => {
            // Stagger requests to avoid rate limits
            await new Promise(r => setTimeout(r, index * 150))

            const prompt = `You are writing a tweet reply. Style: ${styleInfo.prompt}

${ANTI_AI_RULES}

${extraInstruction ? `ADDITIONAL INSTRUCTION: ${extraInstruction}\n` : ''}
Rules:
- all lowercase always
- under 180 characters
- directly respond to what they said
- sound like a real person, not an AI

Tweet to reply to: "${tweetText.slice(0, 500)}"

Write ONLY the reply text, nothing else:`

            // Try Parallax first, then fallback to Groq
            const maxRetries = 3
            let lastError: Error | null = null
            let usedBackend = 'parallax'

            for (let attempt = 0; attempt < maxRetries; attempt++) {
                try {
                    // First attempt: try Parallax with timeout
                    // Subsequent attempts or after Parallax failure: use Groq
                    const useParallax = attempt === 0 && usedBackend === 'parallax'
                    const endpoint = useParallax ? PARALLAX_ENDPOINT : GROQ_ENDPOINT
                    const model = useParallax ? PARALLAX_MODEL : GROQ_MODEL
                    const headers: Record<string, string> = {
                        'Content-Type': 'application/json',
                    }
                    if (!useParallax) {
                        headers['Authorization'] = `Bearer ${GROQ_API_KEY}`
                    }

                    console.log(`[API] Attempt ${attempt + 1} using ${useParallax ? 'Parallax' : 'Groq'}`)

                    const response = await fetchWithTimeout(endpoint, {
                        method: 'POST',
                        headers,
                        body: JSON.stringify({
                            model,
                            messages: [{ role: 'user', content: prompt }],
                            max_tokens: 80,
                            temperature: 1.0,
                        })
                    }, useParallax ? PARALLAX_TIMEOUT : 30000)

                    if (response.status === 429) {
                        // Rate limited - wait and retry
                        const waitTime = Math.pow(2, attempt) * 1000 // 1s, 2s, 4s
                        console.log(`[API] Rate limited, waiting ${waitTime}ms before retry ${attempt + 1}/${maxRetries}`)
                        await new Promise(r => setTimeout(r, waitTime))
                        continue
                    }

                    if (!response.ok) {
                        const errorBody = await response.text()
                        const message = `api error ${response.status}`
                        console.error('[API]', message, errorBody)
                        throw new Error(message)
                    }

                    const data = await response.json()
                    let reply = data.choices?.[0]?.message?.content?.trim() || ''
                    // Clean up the reply
                    reply = reply.replace(/^["']|["']$/g, '') // Remove quotes
                    reply = reply.replace(/—/g, '-') // Replace em dashes
                    reply = reply.toLowerCase()

                    setReplies(prev => prev.map(r =>
                        r.style === styleInfo.style ? { ...r, reply, loading: false } : r
                    ))
                    return // Success - exit retry loop
                } catch (error) {
                    lastError = error instanceof Error ? error : new Error('unknown error')
                    const isAbort = error instanceof Error && error.name === 'AbortError'
                    console.error(`[API] Attempt ${attempt + 1} failed (${isAbort ? 'timeout' : 'error'}):`, error)

                    // If Parallax failed/timed out, switch to Groq for remaining attempts
                    if (usedBackend === 'parallax') {
                        console.log('[API] Parallax failed, switching to Groq fallback')
                        usedBackend = 'groq'
                    }
                }
            }

            // All retries exhausted
            console.error('[API] All retries failed for', styleInfo.style)
            setReplies(prev => prev.map(r =>
                r.style === styleInfo.style ? {
                    ...r,
                    reply: lastError?.message || 'rate limited',
                    loading: false
                } : r
            ))
        })

        await Promise.all(promises)
    }, [])

    // Keep ref in sync
    generateRepliesRef.current = generateReplies

    // Callback ref for webview - triggers when element is mounted
    const webviewCallbackRef = useCallback((webview: any) => {
        console.log('[REF] Webview callback ref called:', !!webview)
        webviewRef.current = webview
        if (webview && !webviewInitializedRef.current) {
            console.log('[REF] Setting up webview initialization...')
            // Set up dom-ready listener
            const handleDomReady = () => {
                console.log('[REF] dom-ready fired!')
                initializeWebview(webview)
            }
            webview.addEventListener('dom-ready', handleDomReady)

            // Also check if already loaded
            setTimeout(() => {
                if (!webviewInitializedRef.current && webview.getURL && webview.getURL()) {
                    console.log('[REF] Webview already has URL, initializing now')
                    initializeWebview(webview)
                }
            }, 100)
        }
    }, [])

    // Webview initialization function
    const initializeWebview = useCallback((webview: any) => {
        if (webviewInitializedRef.current) {
            console.log('[INIT] Already initialized, skipping')
            return
        }
        console.log('[INIT] Initializing webview...')
        webviewInitializedRef.current = true

        // Inject CSS
        webview.insertCSS(`
      [data-testid="sidebarColumn"] { display: none !important; }
      [aria-label="Timeline: Trending now"] { display: none !important; }
      [aria-label="Who to follow"] { display: none !important; }
      [data-testid="primaryColumn"] {
        max-width: 100% !important;
        width: 100% !important;
        border-right: none !important;
      }
      [data-testid="placementTracking"] { display: none !important; }

      .ai-hover {
        background: rgba(29, 155, 240, 0.15) !important;
        outline: 2px solid rgba(29, 155, 240, 0.6) !important;
        outline-offset: -2px;
        border-radius: 12px;
      }
    `)

        // Inject JavaScript
        webview.executeJavaScript(`
      (function() {
        console.log('[WEBVIEW] Initializing AI helper...');

        window.isCtrlPressed = false;
        window.hoveredTweetText = null;
        window.currentHoveredArticle = null;
        window.lastMouseX = 0;
        window.lastMouseY = 0;
        window.lastArticleUnderMouse = null;
        window.targetArticle = null;

        document.addEventListener('mousemove', (e) => {
          window.lastMouseX = e.clientX;
          window.lastMouseY = e.clientY;

          const article = e.target.closest('article[data-testid="tweet"]');
          window.lastArticleUnderMouse = article;

          if (article) {
            const textEl = article.querySelector('[data-testid="tweetText"]');
            if (textEl) {
              const text = textEl.innerText.trim();
              if (text && text.length >= 5) {
                window.hoveredTweetText = text;
                window.targetArticle = article;
              }
            }
          } else {
            window.hoveredTweetText = null;
          }

          window.updateHighlight();
        }, true);

        window.updateHighlight = function() {
          const article = window.lastArticleUnderMouse;
          if (!window.isCtrlPressed) {
            if (window.currentHoveredArticle) {
              window.currentHoveredArticle.classList.remove('ai-hover');
              window.currentHoveredArticle = null;
            }
            return;
          }
          if (!article) {
            if (window.currentHoveredArticle) {
              window.currentHoveredArticle.classList.remove('ai-hover');
              window.currentHoveredArticle = null;
            }
            return;
          }
          if (article !== window.currentHoveredArticle) {
            if (window.currentHoveredArticle) {
              window.currentHoveredArticle.classList.remove('ai-hover');
            }
            window.currentHoveredArticle = article;
            article.classList.add('ai-hover');
          }
        }

        document.addEventListener('keydown', (e) => {
          if (e.key === 'Control' && !window.isCtrlPressed) {
            window.isCtrlPressed = true;
            window.updateHighlight();
          }
        }, true);

        document.addEventListener('keyup', (e) => {
          if (e.key === 'Control') {
            window.isCtrlPressed = false;
            window.updateHighlight();
          }
        }, true);

        window.addEventListener('keydown', (e) => {
          if (e.key === 'Control' && !window.isCtrlPressed) {
            window.isCtrlPressed = true;
            window.updateHighlight();
          }
        }, true);

        window.addEventListener('keyup', (e) => {
          if (e.key === 'Control') {
            window.isCtrlPressed = false;
            window.updateHighlight();
          }
        }, true);

        window.addEventListener('blur', () => {
          window.isCtrlPressed = false;
          window.updateHighlight();
        });

        document.addEventListener('visibilitychange', () => {
          if (document.hidden) {
            window.isCtrlPressed = false;
            window.updateHighlight();
          }
        });

        window.insertReply = async (replyText) => {
          const article = window.targetArticle || window.currentHoveredArticle || window.lastArticleUnderMouse;
          if (!article) { console.log('No article found'); return false; }
          const replyBtn = article.querySelector('[data-testid="reply"]');
          if (!replyBtn) { console.log('No reply button found'); return false; }
          replyBtn.click();
          await new Promise(r => setTimeout(r, 800));
          const composer = document.querySelector('[data-testid="tweetTextarea_0"]');
          if (!composer) { console.log('No composer found'); return false; }
          composer.focus();
          await new Promise(r => setTimeout(r, 150));
          document.execCommand('selectAll', false, null);
          document.execCommand('insertText', false, replyText);
          await new Promise(r => setTimeout(r, 300));
          const submitBtn = document.querySelector('[data-testid="tweetButton"], [data-testid="tweetButtonInline"]');
          if (submitBtn && !submitBtn.disabled) submitBtn.click();
          await new Promise(r => setTimeout(r, 500));
          window.targetArticle = null;
          window.currentHoveredArticle = null;
          window.hoveredTweetText = null;
          window.isCtrlPressed = false;
          document.querySelectorAll('.ai-hover').forEach(el => el.classList.remove('ai-hover'));
          return true;
        };

        document.addEventListener('keydown', (e) => {
          if (e.key === 'Escape') {
            const backBtn = document.querySelector('[data-testid="app-bar-back"]') ||
                            document.querySelector('[aria-label="Back"]') ||
                            document.querySelector('button[aria-label*="Back"]');
            if (backBtn) { backBtn.click(); e.preventDefault(); }
          }
        }, true);

        window.aiHelperReady = true;
        console.log('[WEBVIEW] AI helper initialized successfully!');
      })();
    `).then(() => {
            console.log('[INIT] JS injection complete! Setting webviewReady = true')
        }).catch((err: unknown) => {
            console.log('[INIT] JS injection failed:', err)
        })

        setWebviewReady(true)
        webviewReadyRef.current = true
    }, [])

    const handleRegenerate = () => {
        if (!hoveredTweet || isRegenerating) return
        setIsRegenerating(true)
        generatingForRef.current = null // Force regeneration
        generateReplies(hoveredTweet.text, customPrompt || undefined).finally(() => {
            setIsRegenerating(false)
        })
    }

    // Parent-level Ctrl tracking (works when parent has focus)
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Control') {
                ctrlPressedRef.current = true
                setIsCtrlPressed(true)
            }
        }
        const handleKeyUp = (e: KeyboardEvent) => {
            if (e.key === 'Control') {
                ctrlPressedRef.current = false
                setIsCtrlPressed(false)
            }
        }
        const handleBlur = () => {
            ctrlPressedRef.current = false
            setIsCtrlPressed(false)
        }

        window.addEventListener('keydown', handleKeyDown)
        window.addEventListener('keyup', handleKeyUp)
        window.addEventListener('blur', handleBlur)

        return () => {
            window.removeEventListener('keydown', handleKeyDown)
            window.removeEventListener('keyup', handleKeyUp)
            window.removeEventListener('blur', handleBlur)
        }
    }, [])

    // Poll webview for state - runs continuously
    useEffect(() => {
        console.log('[POLL] Setting up polling interval...')
        let pollCount = 0

        const pollInterval = setInterval(async () => {
            const webview = webviewRef.current
            pollCount++

            // Log every 100 polls (every 5 seconds)
            if (pollCount % 100 === 0) {
                console.log(`[POLL ${pollCount}] webview:`, !!webview, 'ready:', webviewReadyRef.current)
            }

            if (!webview || !webviewReadyRef.current) {
                if (pollCount % 100 === 0) {
                    console.log('[POLL] Skipping - not ready. webview:', !!webview, 'readyRef:', webviewReadyRef.current)
                }
                return
            }

            try {
                const result = await webview.executeJavaScript(`
          (function() {
            return {
              ctrl: !!window.isCtrlPressed,
              text: window.hoveredTweetText || null,
              x: window.lastMouseX || 0,
              y: window.lastMouseY || 0,
              helperReady: !!window.aiHelperReady
            };
          })()
        `)

                // Log if helper isn't ready
                if (!result.helperReady && pollCount % 100 === 0) {
                    console.log('[POLL] Helper not ready in webview!')
                }

                // Combine webview Ctrl with parent Ctrl (OR them)
                const webviewCtrl = result.ctrl
                const parentCtrl = ctrlPressedRef.current
                const newCtrlState = webviewCtrl || parentCtrl

                // Log Ctrl state changes
                if (newCtrlState && pollCount % 20 === 0) {
                    console.log('[POLL] Ctrl pressed! webviewCtrl:', webviewCtrl, 'parentCtrl:', parentCtrl, 'text:', result.text?.slice(0, 30))
                }

                // Push parent Ctrl state to webview if different
                if (parentCtrl && !webviewCtrl) {
                    webview.executeJavaScript(`
            window.isCtrlPressed = true;
            if (typeof window.updateHighlight === 'function') window.updateHighlight();
          `).catch(() => { })
                }

                setIsCtrlPressed(newCtrlState)

                // Handle Ctrl release
                if (!newCtrlState && !isOverPanelRef.current) {
                    if (hoveredTweetRef.current) {
                        setHoveredTweet(null)
                        setReplies([])
                        generatingForRef.current = null
                        lastTextRef.current = null
                        setCustomPrompt('')
                    }
                    return
                }

                // Update hovered tweet if Ctrl is pressed
                if (newCtrlState && result.text) {
                    if (result.text !== lastTextRef.current) {
                        // NEW tweet - set position once
                        console.log('[POLL] NEW TWEET DETECTED:', result.text.slice(0, 50), '...')
                        lastTextRef.current = result.text
                        setHoveredTweet({
                            id: Date.now().toString(),
                            text: result.text,
                            x: result.x,
                            y: result.y
                        })
                        setCustomPrompt('')
                        if (generateRepliesRef.current) {
                            console.log('[POLL] Calling generateReplies...')
                            generateRepliesRef.current(result.text)
                        } else {
                            console.log('[POLL] ERROR: generateRepliesRef.current is null!')
                        }
                    }
                }
            } catch (err) {
                // Webview not ready or error - could reinitialize here if needed
                if (pollCount % 100 === 0) {
                    console.log('[POLL] executeJavaScript error:', err)
                }
            }
        }, 50)

        // Periodically check if helper is still alive and reinit if needed
        const healthCheck = setInterval(async () => {
            const webview = webviewRef.current
            if (!webview || !webviewReadyRef.current) return
            try {
                const ready = await webview.executeJavaScript(`!!window.aiHelperReady`)
                if (!ready) {
                    console.log('[HEALTH] AI helper not ready, reinitializing...')
                    // Reinject the helper JS with same logic as main init
                    await webview.executeJavaScript(`
            (function() {
              if (window.aiHelperReady) return;
              console.log('[WEBVIEW] Reinitializing AI helper...');

              window.isCtrlPressed = false;
              window.hoveredTweetText = null;
              window.currentHoveredArticle = null;
              window.lastMouseX = 0;
              window.lastMouseY = 0;
              window.lastArticleUnderMouse = null;
              window.targetArticle = null;

              // ALWAYS capture tweet text on mousemove
              document.addEventListener('mousemove', (e) => {
                window.lastMouseX = e.clientX;
                window.lastMouseY = e.clientY;
                const article = e.target.closest('article[data-testid="tweet"]');
                window.lastArticleUnderMouse = article;

                if (article) {
                  const textEl = article.querySelector('[data-testid="tweetText"]');
                  if (textEl) {
                    const text = textEl.innerText.trim();
                    if (text && text.length >= 5) {
                      window.hoveredTweetText = text;
                      window.targetArticle = article;
                    }
                  }
                } else {
                  window.hoveredTweetText = null;
                }

                if (window.updateHighlight) window.updateHighlight();
              }, true);

              window.updateHighlight = function() {
                const article = window.lastArticleUnderMouse;
                if (!window.isCtrlPressed) {
                  if (window.currentHoveredArticle) {
                    window.currentHoveredArticle.classList.remove('ai-hover');
                    window.currentHoveredArticle = null;
                  }
                  return;
                }
                if (!article) {
                  if (window.currentHoveredArticle) {
                    window.currentHoveredArticle.classList.remove('ai-hover');
                    window.currentHoveredArticle = null;
                  }
                  return;
                }
                if (article !== window.currentHoveredArticle) {
                  if (window.currentHoveredArticle) {
                    window.currentHoveredArticle.classList.remove('ai-hover');
                  }
                  window.currentHoveredArticle = article;
                  article.classList.add('ai-hover');
                }
              };

              document.addEventListener('keydown', (e) => {
                if (e.key === 'Control' && !window.isCtrlPressed) {
                  window.isCtrlPressed = true;
                  window.updateHighlight();
                }
              }, true);
              document.addEventListener('keyup', (e) => {
                if (e.key === 'Control') {
                  window.isCtrlPressed = false;
                  window.updateHighlight();
                }
              }, true);
              window.addEventListener('blur', () => {
                window.isCtrlPressed = false;
                window.updateHighlight();
              });

              window.insertReply = async (replyText) => {
                const article = window.targetArticle || window.currentHoveredArticle || window.lastArticleUnderMouse;
                if (!article) return false;
                const replyBtn = article.querySelector('[data-testid="reply"]');
                if (!replyBtn) return false;
                replyBtn.click();
                await new Promise(r => setTimeout(r, 800));
                const composer = document.querySelector('[data-testid="tweetTextarea_0"]');
                if (!composer) return false;
                composer.focus();
                await new Promise(r => setTimeout(r, 150));
                document.execCommand('selectAll', false, null);
                document.execCommand('insertText', false, replyText);
                await new Promise(r => setTimeout(r, 300));
                const submitBtn = document.querySelector('[data-testid="tweetButton"], [data-testid="tweetButtonInline"]');
                if (submitBtn && !submitBtn.disabled) submitBtn.click();
                await new Promise(r => setTimeout(r, 500));
                window.targetArticle = null;
                window.currentHoveredArticle = null;
                window.hoveredTweetText = null;
                window.isCtrlPressed = false;
                document.querySelectorAll('.ai-hover').forEach(el => el.classList.remove('ai-hover'));
                return true;
              };

              document.addEventListener('keydown', (e) => {
                if (e.key === 'Escape') {
                  const backBtn = document.querySelector('[data-testid="app-bar-back"]') ||
                                  document.querySelector('[aria-label="Back"]');
                  if (backBtn) { backBtn.click(); e.preventDefault(); }
                }
              }, true);

              window.aiHelperReady = true;
              console.log('[WEBVIEW] AI helper reinitialized!');
            })();
          `)
                }
            } catch {
                // Ignore
            }
        }, 2000)

        return () => {
            clearInterval(pollInterval)
            clearInterval(healthCheck)
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []) // Run once on mount, use refs for current values

    const handleReplyClick = async (reply: string, style: string) => {
        setCopiedStyle(style)

        // Dismiss the panel immediately
        setHoveredTweet(null)
        setIsOverPanel(false)
        setReplies([])
        generatingForRef.current = null
        lastTextRef.current = null
        ctrlPressedRef.current = false
        setIsCtrlPressed(false)

        const webview = webviewRef.current
        if (webview) {
            try {
                await webview.executeJavaScript(`window.insertReply(${JSON.stringify(reply)})`)
            } catch (err) {
                console.error('Failed to insert reply:', err)
            }
        }

        setTimeout(() => setCopiedStyle(null), 1500)
    }

    // Calculate panel position
    const getPanelStyle = () => {
        if (!hoveredTweet) return {}

        const panelWidth = 400
        const panelHeight = 520
        const padding = 20

        let x = hoveredTweet.x + padding
        let y = hoveredTweet.y - panelHeight / 2

        if (x + panelWidth > window.innerWidth) {
            x = hoveredTweet.x - panelWidth - padding
        }
        if (y < padding) y = padding
        if (y + panelHeight > window.innerHeight - padding) {
            y = window.innerHeight - panelHeight - padding
        }

        return { left: x, top: y }
    }

    const showPanel = (hoveredTweet && isCtrlPressed) || (hoveredTweet && isOverPanel)

    return (
        <div className="h-screen bg-black text-white overflow-hidden relative">
            <webview
                ref={webviewCallbackRef}
                src="https://x.com/home"
                className="w-full h-full"
                {...{ allowpopups: 'true', partition: 'persist:x' } as any}
            />

            {/* Ctrl indicator */}
            <AnimatePresence>
                {isCtrlPressed && !hoveredTweet && (
                    <motion.div
                        initial={{ opacity: 0, scale: 0.9, y: 20 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.9, y: 20 }}
                        className="fixed bottom-8 left-1/2 -translate-x-1/2 z-50"
                    >
                        <motion.div
                            animate={{
                                boxShadow: [
                                    '0 0 20px rgba(29, 155, 240, 0.4)',
                                    '0 0 50px rgba(29, 155, 240, 0.8)',
                                    '0 0 20px rgba(29, 155, 240, 0.4)',
                                ]
                            }}
                            transition={{ duration: 1.2, repeat: Infinity }}
                            className="bg-gradient-to-r from-blue-600 via-blue-500 to-cyan-500 px-8 py-4 rounded-2xl"
                        >
                            <span className="text-white font-semibold text-lg">
                                Hover over any tweet
                            </span>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Reply panel */}
            <AnimatePresence>
                {showPanel && (
                    <motion.div
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.95 }}
                        className="fixed w-[400px] z-50"
                        style={getPanelStyle()}
                        onMouseEnter={() => setIsOverPanel(true)}
                        onMouseLeave={() => setIsOverPanel(false)}
                    >
                        <div className="bg-black/95 backdrop-blur-xl border border-blue-500/40 rounded-2xl overflow-hidden shadow-2xl">
                            {/* Header */}
                            <div className="px-4 py-2.5 bg-gradient-to-r from-blue-600/30 to-cyan-600/20 border-b border-white/10">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                        <motion.div
                                            animate={{ scale: [1, 1.3, 1] }}
                                            transition={{ duration: 0.8, repeat: Infinity }}
                                            className="w-2 h-2 bg-blue-400 rounded-full"
                                        />
                                        <span className="text-sm font-semibold text-blue-400">AI Replies</span>
                                    </div>
                                    <button
                                        onClick={handleRegenerate}
                                        disabled={isRegenerating}
                                        className="p-1.5 hover:bg-white/10 rounded-lg transition-colors disabled:opacity-50"
                                        title="Regenerate"
                                    >
                                        <RefreshCw className={`w-4 h-4 text-blue-400 ${isRegenerating ? 'animate-spin' : ''}`} />
                                    </button>
                                </div>
                            </div>

                            {/* Tweet text - full content */}
                            <div className="px-4 py-3 border-b border-white/10 bg-white/5 max-h-[120px] overflow-y-auto">
                                <p className="text-[13px] text-gray-300 leading-relaxed whitespace-pre-wrap">
                                    {hoveredTweet?.text}
                                </p>
                            </div>

                            {/* Reply options */}
                            <div className="p-2.5 space-y-1.5 max-h-[280px] overflow-y-auto">
                                {replies.map((option) => (
                                    <div key={option.style} className="group">
                                        <div className="flex items-center gap-2 mb-1 px-1">
                                            <span className="text-[10px] uppercase tracking-wider text-blue-400/70 font-bold">
                                                {option.label}
                                            </span>
                                            {copiedStyle === option.style && (
                                                <span className="text-[10px] text-green-400">inserted!</span>
                                            )}
                                        </div>

                                        {option.loading ? (
                                            <div className="flex items-center gap-2 py-2.5 px-3 bg-white/5 rounded-lg">
                                                <motion.div className="w-1.5 h-1.5 bg-blue-400 rounded-full"
                                                    animate={{ opacity: [0.3, 1, 0.3] }}
                                                    transition={{ duration: 0.5, repeat: Infinity }}
                                                />
                                                <motion.div className="w-1.5 h-1.5 bg-blue-400 rounded-full"
                                                    animate={{ opacity: [0.3, 1, 0.3] }}
                                                    transition={{ duration: 0.5, repeat: Infinity, delay: 0.1 }}
                                                />
                                                <motion.div className="w-1.5 h-1.5 bg-blue-400 rounded-full"
                                                    animate={{ opacity: [0.3, 1, 0.3] }}
                                                    transition={{ duration: 0.5, repeat: Infinity, delay: 0.2 }}
                                                />
                                            </div>
                                        ) : option.reply ? (
                                            <button
                                                onClick={() => handleReplyClick(option.reply!, option.style)}
                                                className="w-full text-left px-3 py-2.5 bg-white/5 hover:bg-blue-500/20 border border-transparent hover:border-blue-500/30 rounded-lg transition-all cursor-pointer"
                                            >
                                                <p className="text-[13px] text-gray-100 leading-relaxed">
                                                    {option.reply}
                                                </p>
                                            </button>
                                        ) : null}
                                    </div>
                                ))}
                            </div>

                            {/* Regenerate input */}
                            <div className="px-3 py-2.5 border-t border-white/10 bg-white/5">
                                <div className="flex gap-2">
                                    <input
                                        type="text"
                                        value={customPrompt}
                                        onChange={(e) => setCustomPrompt(e.target.value)}
                                        onKeyDown={(e) => e.key === 'Enter' && handleRegenerate()}
                                        placeholder="adjust tone, e.g. 'more sarcastic'"
                                        className="flex-1 bg-black/50 border border-white/10 rounded-lg px-3 py-1.5 text-[12px] text-white placeholder-gray-500 focus:outline-none focus:border-blue-500/50"
                                    />
                                    <button
                                        onClick={handleRegenerate}
                                        disabled={isRegenerating}
                                        className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 rounded-lg text-[12px] font-medium transition-colors disabled:opacity-50"
                                    >
                                        {isRegenerating ? '...' : 'Go'}
                                    </button>
                                </div>
                            </div>

                            {/* Footer */}
                            <div className="px-4 py-2 border-t border-white/5 text-center">
                                <p className="text-[10px] text-gray-600">
                                    click reply to insert • release ctrl to dismiss
                                </p>
                            </div>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    )
}

export default App
