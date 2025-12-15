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

// API configuration - set VITE_API_BACKEND to 'parallax' to use local backend
const API_BACKEND = import.meta.env.VITE_API_BACKEND || 'groq'
const PARALLAX_ENDPOINT = import.meta.env.VITE_PARALLAX_ENDPOINT || 'http://localhost:8000/v1/chat/completions'
const GROQ_ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions'
const GROQ_API_KEY = import.meta.env.VITE_GROQ_API_KEY || ''
const GROQ_MODEL = 'llama-3.3-70b-versatile'
const PARALLAX_MODEL = import.meta.env.VITE_PARALLAX_MODEL || 'default'

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

const STYLE_RULES = `
CRITICAL RULES - VIOLATIONS WILL BE REJECTED:
- NEVER use emojis under any circumstances
- NEVER use em dashes (—) under any circumstances
- NEVER ask questions to "elicit engagement" or prompt responses
- NEVER use phrases like "this is so", "I love this", "absolutely", "literally"
- NEVER say "atcha", "gotcha", "ya", "get it", or other LLM-isms
- NEVER start with "I"
- NEVER use corporate speak or buzzwords
- Your reply MUST reference specific content from the tweet (names, topics, claims, etc)
- Generic replies that could apply to any tweet are FORBIDDEN
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
    const [currentUrl, setCurrentUrl] = useState('https://x.com/home')
    const [urlInput, setUrlInput] = useState('https://x.com/home')
    const [postPanelUrl, setPostPanelUrl] = useState<string | null>(null)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const webviewRef = useRef<any>(null)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const postWebviewRef = useRef<any>(null)
    // Track which webview has the active hover ('main' or 'post')
    const activeHoverWebviewRef = useRef<'main' | 'post'>('main')
    // Track if post panel webview is ready
    const postWebviewReadyRef = useRef(false)
    // Track if post panel listeners are set up
    const postListenersSetupRef = useRef(false)
    const generatingForRef = useRef<string | null>(null)
    const lastTextRef = useRef<string | null>(null)
    const ctrlPressedRef = useRef(false)
    const isOverPanelRef = useRef(false)
    const hoveredTweetRef = useRef<HoveredTweet | null>(null)
    const currentUrlRef = useRef('https://x.com/home')
    const postPanelUrlRef = useRef<string | null>(null)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const generateRepliesRef = useRef<any>(null)
    const webviewReadyRef = useRef(false)

    // Keep refs in sync
    isOverPanelRef.current = isOverPanel
    hoveredTweetRef.current = hoveredTweet
    webviewReadyRef.current = webviewReady
    currentUrlRef.current = currentUrl
    postPanelUrlRef.current = postPanelUrl

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

${STYLE_RULES}

${extraInstruction ? `ADDITIONAL INSTRUCTION: ${extraInstruction}\n` : ''}
Rules:
- all lowercase always
- under 180 characters
- directly respond to what they said
- sound like a real person typing casually

Tweet to reply to: "${tweetText.slice(0, 500)}"

Write ONLY the reply text, nothing else:`

            // Use configured API backend with retry logic
            const maxRetries = 3
            let lastError: Error | null = null
            const useParallax = API_BACKEND === 'parallax'
            const endpoint = useParallax ? PARALLAX_ENDPOINT : GROQ_ENDPOINT
            const model = useParallax ? PARALLAX_MODEL : GROQ_MODEL

            for (let attempt = 0; attempt < maxRetries; attempt++) {
                try {
                    console.log(`[API] Attempt ${attempt + 1} using ${useParallax ? 'Parallax' : 'Groq'}`)

                    const headers: Record<string, string> = {
                        'Content-Type': 'application/json',
                    }
                    // Only add Authorization header for Groq
                    if (!useParallax && GROQ_API_KEY) {
                        headers['Authorization'] = `Bearer ${GROQ_API_KEY}`
                    }

                    const response = await fetchWithTimeout(endpoint, {
                        method: 'POST',
                        headers,
                        body: JSON.stringify({
                            model,
                            messages: [{ role: 'user', content: prompt }],
                            max_tokens: 80,
                            temperature: 1.0,
                        })
                    }, 30000)

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

    // Handle clipboard request from webview console messages
    const handleConsoleMessage = useCallback(async (event: any) => {
        // Debug: log the entire event to understand its structure
        console.log('[CONSOLE-MSG] Event received, level:', event.level, 'line:', event.line)
        console.log('[CONSOLE-MSG] Message:', event.message)

        // Also write to file for persistence
        const electronAPI = (window as any).electronAPI
        if (electronAPI?.debugLog) {
            electronAPI.debugLog(`[WEBVIEW] ${event.message}`)
        }

        const message = event.message

        // Handle split view requests from webview
        if (message && message.startsWith('[SPLIT_VIEW_REQUEST]')) {
            console.log('[RENDERER] Got split view request from webview')
            try {
                const jsonStr = message.replace('[SPLIT_VIEW_REQUEST]', '').trim()
                const request = JSON.parse(jsonStr)
                if (request.url) {
                    console.log('[RENDERER] Opening in split panel:', request.url)

                    // Check if this is the same URL already open
                    const isSameUrl = postPanelUrlRef.current === request.url
                    console.log('[RENDERER] isSameUrl:', isSameUrl, 'current:', postPanelUrlRef.current)

                    // Save scroll position before opening split (resize can cause scroll jump)
                    const mainWebview = webviewRef.current
                    if (mainWebview) {
                        mainWebview.executeJavaScript(`
                            (function() {
                                const scrollY = window.scrollY;
                                console.log('[SPLIT] Saving scroll before split open:', scrollY);
                                window.__preSplitScroll = scrollY;
                            })();
                        `).catch(() => {})
                    }

                    // Reset post panel ready state so it re-injects on new URL
                    if (!isSameUrl) {
                        postWebviewReadyRef.current = false
                    }

                    // Always set URL (even if same, to ensure state is correct)
                    setPostPanelUrl(request.url)

                    // Restore scroll position after split opens
                    setTimeout(() => {
                        if (mainWebview) {
                            mainWebview.executeJavaScript(`
                                (function() {
                                    if (typeof window.__preSplitScroll === 'number') {
                                        console.log('[SPLIT] Restoring scroll after split open:', window.__preSplitScroll);
                                        window.scrollTo(0, window.__preSplitScroll);
                                        delete window.__preSplitScroll;
                                    }
                                })();
                            `).catch(() => {})
                        }
                    }, 300)

                    // Aggressive focus sequence for post panel composer
                    const focusComposer = (attempt: number) => {
                        const postWv = postWebviewRef.current
                        if (!postWv) {
                            console.log('[SPLIT] No postWebviewRef, aborting focus')
                            return
                        }
                        if (attempt > 15) {
                            console.log('[SPLIT] Max focus attempts reached')
                            return
                        }

                        const debugLog = (msg: string) => {
                            console.log(msg)
                            ;(window as any).electronAPI?.debugLog?.(msg)
                        }
                        debugLog('[SPLIT] Focus attempt ' + attempt)

                        // First focus the webview element itself
                        postWv.focus()

                        // Then execute JS to find the composer and get its coordinates
                        postWv.executeJavaScript(`
                            (async function() {
                                // Helper to simulate real mouse click (needed for DraftJS editors)
                                const simulateClick = (el) => {
                                    const rect = el.getBoundingClientRect();
                                    const x = rect.left + rect.width / 2;
                                    const y = rect.top + rect.height / 2;
                                    const opts = { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y };
                                    el.dispatchEvent(new MouseEvent('mousedown', opts));
                                    el.dispatchEvent(new MouseEvent('mouseup', opts));
                                    el.dispatchEvent(new MouseEvent('click', opts));
                                };

                                // First, try to click the reply placeholder to expand the composer
                                // X shows a collapsed "Post your reply" area that needs to be clicked
                                const replyPlaceholders = [
                                    '[data-testid="tweetTextarea_0RichTextInputContainer"]',
                                    '[data-testid="toolBar"] ~ div [role="textbox"]',
                                    '[placeholder="Post your reply"]',
                                    '[aria-label="Post your reply"]',
                                    '[data-text="true"]'
                                ];
                                let clickedPlaceholder = false;
                                for (const sel of replyPlaceholders) {
                                    const placeholder = document.querySelector(sel);
                                    if (placeholder) {
                                        console.log('[SPLIT-FOCUS] Scrolling and clicking reply placeholder:', sel);
                                        placeholder.scrollIntoView({ behavior: 'instant', block: 'center' });
                                        await new Promise(r => setTimeout(r, 50));
                                        simulateClick(placeholder);
                                        clickedPlaceholder = true;
                                        break;
                                    }
                                }

                                // Wait for composer to appear after clicking placeholder
                                if (clickedPlaceholder) {
                                    await new Promise(r => setTimeout(r, 200));
                                }

                                // Now try to find the actual composer and return its coordinates
                                const selectors = [
                                    '[data-testid="tweetTextarea_0"]',
                                    '[data-testid="tweetTextarea_0_label"]',
                                    '[role="textbox"][data-testid]',
                                    '.public-DraftEditor-content',
                                    '[contenteditable="true"]'
                                ];
                                for (const sel of selectors) {
                                    const el = document.querySelector(sel);
                                    if (el) {
                                        // Scroll into view first to ensure visibility even if large image takes space
                                        el.scrollIntoView({ behavior: 'instant', block: 'center' });
                                        await new Promise(r => setTimeout(r, 100));
                                        const rect = el.getBoundingClientRect();
                                        const x = Math.round(rect.left + rect.width / 2);
                                        const y = Math.round(rect.top + rect.height / 2);
                                        console.log('[SPLIT-FOCUS] Found composer at:', x, y, sel);
                                        // Also do DOM focus as backup
                                        simulateClick(el);
                                        el.focus();
                                        return { found: true, x, y, selector: sel };
                                    }
                                }
                                console.log('[SPLIT-FOCUS] No composer found yet');
                                return { found: false, x: 0, y: 0, selector: null };
                            })()
                        `).then((result: { found: boolean, x: number, y: number, selector: string | null }) => {
                            debugLog('[SPLIT] Focus result: ' + result.found + ' at ' + result.x + ',' + result.y)
                            if (!result.found && attempt < 15) {
                                // Retry after delay
                                setTimeout(() => focusComposer(attempt + 1), 400)
                            } else if (result.found) {
                                // Use Electron's sendInputEvent for REAL mouse click
                                // This bypasses DOM and goes through Chromium's input pipeline
                                debugLog('[SPLIT] Sending real input event at ' + result.x + ',' + result.y)
                                try {
                                    // Send mousedown, mouseup, click sequence
                                    postWv.sendInputEvent({ type: 'mouseDown', x: result.x, y: result.y, button: 'left', clickCount: 1 })
                                    postWv.sendInputEvent({ type: 'mouseUp', x: result.x, y: result.y, button: 'left', clickCount: 1 })
                                    debugLog('[SPLIT] Real input events sent successfully')
                                } catch (e) {
                                    debugLog('[SPLIT] sendInputEvent error: ' + e)
                                }
                                // Also focus the webview element
                                postWv.focus()
                            }
                        }).catch((err: unknown) => {
                            debugLog('[SPLIT] Focus error: ' + err)
                            if (attempt < 15) {
                                setTimeout(() => focusComposer(attempt + 1), 400)
                            }
                        })
                    }

                    // If same URL, focus immediately (page already loaded)
                    // If new URL, wait for page to load first
                    const focusDelay = isSameUrl ? 100 : 1000
                    console.log('[RENDERER] Scheduling focus with delay:', focusDelay)
                    setTimeout(() => focusComposer(1), focusDelay)
                }
            } catch (err) {
                console.error('[SPLIT] Error parsing request:', err)
            }
            return
        }

        if (message && message.startsWith('[CLIPBOARD_REQUEST]')) {
            console.log('[RENDERER] Got clipboard request from webview')
            try {
                const jsonStr = message.replace('[CLIPBOARD_REQUEST]', '').trim()
                const request = JSON.parse(jsonStr)
                if (request.type === 'clipboard-paste-request') {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    const electronAPI = (window as any).electronAPI
                    if (!electronAPI) {
                        console.log('[RENDERER] electronAPI not available!')
                        return
                    }

                    const webview = webviewRef.current
                    if (!webview) {
                        console.log('[RENDERER] webview not available!')
                        return
                    }

                    // Check for image first
                    console.log('[RENDERER] Checking clipboard for image...')
                    const hasImage = await electronAPI.clipboardHasImage()
                    console.log('[RENDERER] hasImage:', hasImage)
                    if (hasImage) {
                        const imageDataUrl = await electronAPI.clipboardReadImage()
                        console.log('[RENDERER] Got image dataUrl, length:', imageDataUrl?.length)
                        if (imageDataUrl) {
                            webview.executeJavaScript(`
                                window.postMessage({
                                    type: 'clipboard-paste-response',
                                    requestId: '${request.requestId}',
                                    dataType: 'image',
                                    data: '${imageDataUrl}'
                                }, '*');
                            `)
                            return
                        }
                    }

                    // Fall back to text
                    const text = await electronAPI.clipboardReadText()
                    webview.executeJavaScript(`
                        window.postMessage({
                            type: 'clipboard-paste-response',
                            requestId: '${request.requestId}',
                            dataType: 'text',
                            data: ${JSON.stringify(text)}
                        }, '*');
                    `)
                }
            } catch (err) {
                console.error('[CLIPBOARD] Error parsing request:', err)
            }
        }
    }, [])

    // Track if we've set up listeners (to avoid duplicates)
    const listenersSetupRef = useRef(false)
    // Track if CSS has been injected (to avoid duplicate injection)
    const cssInjectedRef = useRef(false)
    // Store listener references for cleanup
    const listenersRef = useRef<{
        domReady?: () => void
        consoleMessage?: (e: any) => void
        didNavigate?: (e: any) => void
        didNavigateInPage?: (e: any) => void
    }>({})

    // Callback ref for webview - triggers when element is mounted
    const webviewCallbackRef = useCallback((webview: any) => {
        console.log('[REF] Webview callback ref called:', !!webview)

        // Cleanup old listeners if webview changed
        if (webviewRef.current && webviewRef.current !== webview && listenersSetupRef.current) {
            console.log('[REF] Cleaning up old listeners...')
            const oldWebview = webviewRef.current
            const listeners = listenersRef.current
            if (listeners.domReady) oldWebview.removeEventListener('dom-ready', listeners.domReady)
            if (listeners.consoleMessage) oldWebview.removeEventListener('console-message', listeners.consoleMessage)
            if (listeners.didNavigate) oldWebview.removeEventListener('did-navigate', listeners.didNavigate)
            if (listeners.didNavigateInPage) oldWebview.removeEventListener('did-navigate-in-page', listeners.didNavigateInPage)
            if (listeners.willNavigate) oldWebview.removeEventListener('will-navigate', listeners.willNavigate)
            listenersSetupRef.current = false
            cssInjectedRef.current = false
        }

        webviewRef.current = webview

        // Set up listeners for new webview
        if (webview && !listenersSetupRef.current) {
            console.log('[REF] Setting up webview listeners...')
            listenersSetupRef.current = true

            // Set max listeners immediately to prevent warning
            try {
                 if (webview.setMaxListeners) {
                     webview.setMaxListeners(50)
                 }
            } catch { /* ignore */ }

            // Create listener functions
            const handleDomReady = () => {
                console.log('[REF] dom-ready fired, injecting helpers...')
                // Increase max listeners on webview's webContents to prevent warning
                try {
                    const wc = webview.getWebContents?.()
                    if (wc) {
                        if (wc.setMaxListeners) {
                            wc.setMaxListeners(50)
                        }
                        // Also attach console-message listener to webContents as fallback
                        wc.on('console-message', (_event: any, level: number, message: string, line: number, sourceId: string) => {
                            console.log('[WC-CONSOLE]', { level, message, line, sourceId })
                            // Also call our handler
                            handleConsoleMessage({ level, message, line, sourceId })
                        })
                        console.log('[REF] Attached console-message listener to webContents')
                    }
                } catch (e) {
                    console.log('[REF] Failed to access webContents:', e)
                }
                injectHelpers(webview)
            }

            const handleDidNavigate = (e: any) => {
                console.log('[NAV] did-navigate:', e.url)
                setUrlInput(e.url)
                setCurrentUrl(e.url)
            }

            const handleDidNavigateInPage = (e: any) => {
                console.log('[NAV] did-navigate-in-page:', e.url)
                setUrlInput(e.url)
                setCurrentUrl(e.url)
            }

            // Intercept navigation to open posts in split panel
            const handleWillNavigate = (e: any) => {
                const targetUrl = e.url
                const currentPath = currentUrlRef.current
                console.log('[NAV] will-navigate:', targetUrl, 'from:', currentPath)

                // Check if navigating to a post URL (pattern: /username/status/id)
                const isPostUrl = /\/[^/]+\/status\/\d+/.test(targetUrl) && !targetUrl.includes('/photo/')
                // Only intercept if we're on notifications, home, or a list
                const shouldIntercept = /\/(notifications|home)/.test(currentPath) || /\/i\/lists\//.test(currentPath)

                if (isPostUrl && shouldIntercept) {
                    console.log('[NAV] Intercepting post navigation, opening in panel')
                    e.preventDefault()
                    setPostPanelUrl(targetUrl)
                    return
                }
            }

            // Store references for cleanup
            listenersRef.current = {
                domReady: handleDomReady,
                consoleMessage: handleConsoleMessage,
                didNavigate: handleDidNavigate,
                didNavigateInPage: handleDidNavigateInPage,
                willNavigate: handleWillNavigate
            }

            // Add listeners
            webview.addEventListener('dom-ready', handleDomReady)
            webview.addEventListener('console-message', handleConsoleMessage)
            webview.addEventListener('did-navigate', handleDidNavigate)
            webview.addEventListener('did-navigate-in-page', handleDidNavigateInPage)
            webview.addEventListener('will-navigate', handleWillNavigate)

            console.log('[LISTENER] All listeners added to webview')

            // Test if console-message listener works
            setTimeout(() => {
                if (webview && webview.executeJavaScript) {
                    console.log('[TEST] Sending test console.log to webview...')
                    webview.executeJavaScript(`console.log('[TEST] Hello from webview - if you see this in CONSOLE-MSG, console-message works!')`)
                        .then(() => console.log('[TEST] Test script executed'))
                        .catch((err: any) => console.log('[TEST] Test script failed:', err))
                }
            }, 1000)
        }
    }, [handleConsoleMessage])

    // Callback ref for post panel webview - triggers when element is mounted
    const postWebviewCallbackRef = useCallback((webview: any) => {
        const debugLog = (msg: string) => {
            console.log(msg)
            ;(window as any).electronAPI?.debugLog?.(msg)
        }
        debugLog('[POST-PANEL-REF] Post webview callback ref called: ' + !!webview)

        // Cleanup old listeners if webview changed or unmounted
        if (postWebviewRef.current && postWebviewRef.current !== webview && postListenersSetupRef.current) {
            debugLog('[POST-PANEL-REF] Cleaning up old listeners...')
            const oldWebview = postWebviewRef.current
            try {
                oldWebview.removeEventListener('dom-ready', oldWebview._postPanelDomReady)
                oldWebview.removeEventListener('did-navigate-in-page', oldWebview._postPanelInPageNav)
            } catch { /* ignore */ }
            postListenersSetupRef.current = false
            postWebviewReadyRef.current = false
        }

        postWebviewRef.current = webview

        // Set up listeners for new webview
        if (webview && !postListenersSetupRef.current) {
            debugLog('[POST-PANEL-REF] Setting up post panel listeners...')
            postListenersSetupRef.current = true

            const handleDomReady = () => {
                // Guard against multiple calls
                if (postWebviewReadyRef.current) {
                    debugLog('[POST-PANEL] Already injected, skipping...')
                    return
                }
                debugLog('[POST-PANEL] dom-ready fired, injecting helpers...')
                postWebviewReadyRef.current = true

                // Inject CSS
                webview.insertCSS(`
                    /* Hide sidebar in post panel */
                    [data-testid="sidebarColumn"] { display: none !important; }
                    [data-testid="primaryColumn"] {
                        max-width: 100% !important;
                        width: 100% !important;
                        border-right: none !important;
                    }
                    /* Force GPU compositing for video */
                    video {
                        will-change: transform !important;
                        transform: translateZ(0) !important;
                    }
                    /* Hover highlight */
                    .parallax-hover {
                        background: rgba(29, 155, 240, 0.15) !important;
                        outline: 2px solid rgba(29, 155, 240, 0.6) !important;
                        outline-offset: -2px;
                        border-radius: 12px;
                    }
                `).catch((err: unknown) => console.log('[POST-PANEL] CSS error:', err))

                // Inject JS for hover tracking, reply insertion, and auto-focus
                webview.executeJavaScript(`
                    (function() {
                        if (window.parallaxPostPanelReady) {
                            console.log('[POST-PANEL] Already initialized, skipping');
                            return;
                        }
                        console.log('[POST-PANEL] Initializing helpers...');

                        window.isCtrlPressed = false;
                        window.hoveredTweetText = null;
                        window.currentHoveredArticle = null;
                        window.lastMouseX = 0;
                        window.lastMouseY = 0;
                        window.targetArticle = null;

                        // Update highlight on hovered article
                        window.updateHighlight = function() {
                            document.querySelectorAll('.parallax-hover').forEach(el => el.classList.remove('parallax-hover'));
                            if (window.isCtrlPressed && window.targetArticle) {
                                window.targetArticle.classList.add('parallax-hover');
                            }
                        };

                        // Mouse move tracking - CLEAR text when not over an article
                        document.addEventListener('mousemove', (e) => {
                            window.lastMouseX = e.clientX;
                            window.lastMouseY = e.clientY;

                            const article = e.target.closest('article[data-testid="tweet"]');
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
                                // IMPORTANT: Clear hover text when mouse is NOT over an article
                                window.hoveredTweetText = null;
                                window.targetArticle = null;
                            }
                            window.updateHighlight();
                        });

                        // Ctrl key tracking - only LEFT Ctrl for AI popup
                        document.addEventListener('keydown', (e) => {
                            if (e.key === 'Control' && e.location === 1) {
                                window.isCtrlPressed = true;
                                window.updateHighlight();
                            }
                        });
                        document.addEventListener('keyup', (e) => {
                            if (e.key === 'Control' && e.location === 1) {
                                window.isCtrlPressed = false;
                                window.updateHighlight();
                            }
                        });
                        window.addEventListener('blur', () => {
                            window.isCtrlPressed = false;
                            window.updateHighlight();
                        });

                        // Reply insertion function with clear and auto-submit
                        window.insertReply = function(text) {
                            console.log('[POST-PANEL] insertReply called with:', text?.slice(0, 50));
                            const composer = document.querySelector('[data-testid="tweetTextarea_0"]');
                            if (composer) {
                                composer.focus();

                                // Clear existing content first by selecting all and deleting
                                document.execCommand('selectAll', false, null);
                                document.execCommand('delete', false, null);

                                // Insert new text via paste
                                const dataTransfer = new DataTransfer();
                                dataTransfer.setData('text/plain', text);
                                const pasteEvent = new ClipboardEvent('paste', {
                                    bubbles: true,
                                    cancelable: true,
                                    clipboardData: dataTransfer
                                });
                                composer.dispatchEvent(pasteEvent);
                                console.log('[POST-PANEL] Reply inserted via paste event');

                                // Auto-submit after a short delay (wait for button to become enabled)
                                const trySubmit = (attempts) => {
                                    const replyButton = document.querySelector('[data-testid="tweetButtonInline"], [data-testid="tweetButton"]');
                                    console.log('[POST-PANEL] Submit attempt', attempts, 'button:', !!replyButton, 'disabled:', replyButton?.disabled);
                                    if (replyButton && !replyButton.disabled) {
                                        console.log('[POST-PANEL] Clicking reply button...');
                                        replyButton.click();
                                    } else if (attempts < 10) {
                                        // Button might not be enabled yet, retry
                                        setTimeout(() => trySubmit(attempts + 1), 200);
                                    } else {
                                        console.log('[POST-PANEL] Reply button not found or stayed disabled after retries');
                                    }
                                };
                                setTimeout(() => trySubmit(0), 300);
                            } else {
                                console.log('[POST-PANEL] No composer found for reply insertion');
                            }
                        };

                        window.parallaxPostPanelReady = true;
                        console.log('[POST-PANEL] Helpers initialized!');

                        // Helper to simulate real mouse click (needed for DraftJS editors)
                        const simulateClick = (el) => {
                            const rect = el.getBoundingClientRect();
                            const x = rect.left + rect.width / 2;
                            const y = rect.top + rect.height / 2;
                            const opts = { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y };
                            el.dispatchEvent(new MouseEvent('mousedown', opts));
                            el.dispatchEvent(new MouseEvent('mouseup', opts));
                            el.dispatchEvent(new MouseEvent('click', opts));
                        };

                        // Auto-focus composer after a short delay
                        let focusAttempts = 0;
                        const tryFocus = async () => {
                            focusAttempts++;
                            console.log('[POST-PANEL] Focus attempt', focusAttempts);

                            // First, try to click the reply placeholder to expand the composer
                            // X shows a collapsed "Post your reply" area that needs to be clicked
                            const replyPlaceholders = [
                                '[data-testid="tweetTextarea_0RichTextInputContainer"]',
                                '[data-testid="toolBar"] ~ div [role="textbox"]',
                                '[placeholder="Post your reply"]',
                                '[aria-label="Post your reply"]',
                                '[data-text="true"]'
                            ];
                            let clickedPlaceholder = false;
                            for (const sel of replyPlaceholders) {
                                const placeholder = document.querySelector(sel);
                                if (placeholder) {
                                    console.log('[POST-PANEL] Scrolling and clicking reply placeholder:', sel);
                                    placeholder.scrollIntoView({ behavior: 'instant', block: 'center' });
                                    await new Promise(r => setTimeout(r, 50));
                                    simulateClick(placeholder);
                                    clickedPlaceholder = true;
                                    break;
                                }
                            }

                            // Wait for composer to appear after clicking placeholder
                            if (clickedPlaceholder) {
                                await new Promise(r => setTimeout(r, 200));
                            }

                            // Try multiple selectors for the composer
                            const selectors = [
                                '[data-testid="tweetTextarea_0"]',
                                '[data-testid="tweetTextarea_0_label"]',
                                '[role="textbox"][data-testid]',
                                '.public-DraftEditor-content',
                                '[contenteditable="true"]'
                            ];

                            let composer = null;
                            for (const sel of selectors) {
                                composer = document.querySelector(sel);
                                if (composer) {
                                    console.log('[POST-PANEL] Found composer with selector:', sel);
                                    break;
                                }
                            }

                            if (composer) {
                                console.log('[POST-PANEL] Scrolling composer into view and focusing...');
                                composer.scrollIntoView({ behavior: 'instant', block: 'center' });
                                // Small delay after scroll to ensure it's visible
                                await new Promise(r => setTimeout(r, 100));
                                simulateClick(composer);
                                composer.focus();
                                console.log('[POST-PANEL] Focused composer!');
                            } else if (focusAttempts < 20) {
                                console.log('[POST-PANEL] Composer not found, retrying...');
                                setTimeout(tryFocus, 300);
                            } else {
                                console.log('[POST-PANEL] Gave up finding composer after', focusAttempts, 'attempts');
                            }
                        };
                        setTimeout(tryFocus, 800);

                        // Add click listener on posts to focus reply field
                        document.addEventListener('click', async (e) => {
                            const article = e.target.closest('article[data-testid="tweet"]');
                            // Only proceed if clicking on a post article
                            if (!article) return;

                            // Don't interfere if clicking on interactive elements (links, buttons, etc)
                            const interactiveEl = e.target.closest('a, button, [role="button"], [data-testid="like"], [data-testid="retweet"], [data-testid="reply"], [role="textbox"], [contenteditable="true"]');
                            if (interactiveEl) return;

                            console.log('[POST-PANEL] Click on post detected, focusing reply...');

                            // Short delay to let any other handlers run first
                            await new Promise(r => setTimeout(r, 100));

                            // Find and focus the composer
                            const selectors = [
                                '[data-testid="tweetTextarea_0"]',
                                '[role="textbox"][data-testid]',
                                '.public-DraftEditor-content',
                                '[contenteditable="true"]'
                            ];

                            for (const sel of selectors) {
                                const composer = document.querySelector(sel);
                                if (composer) {
                                    console.log('[POST-PANEL] Click: Scrolling and focusing composer');
                                    composer.scrollIntoView({ behavior: 'instant', block: 'center' });
                                    await new Promise(r => setTimeout(r, 50));
                                    simulateClick(composer);
                                    composer.focus();
                                    break;
                                }
                            }
                        }, true); // Use capture phase
                    })();
                `).then(() => {
                    debugLog('[POST-PANEL] JS injection complete!')
                }).catch((err: unknown) => debugLog('[POST-PANEL] JS error: ' + err))
            }

            // Store reference for cleanup
            webview._postPanelDomReady = handleDomReady
            webview.addEventListener('dom-ready', handleDomReady)
            // Also listen to did-finish-load as backup
            webview.addEventListener('did-finish-load', handleDomReady)

            // Add console-message listener to see logs from post panel
            webview.addEventListener('console-message', (e: any) => {
                if (e.message?.includes('[POST-PANEL]') || e.message?.includes('[SPLIT-FOCUS]')) {
                    console.log('[POST-PANEL-CONSOLE]', e.message)
                    ;(window as any).electronAPI?.debugLog?.('[POST-PANEL-CONSOLE] ' + e.message)
                }
            })

            // Add did-navigate-in-page listener to re-trigger focus on SPA navigation
            const handleInPageNavigation = (e: any) => {
                const url = e.url || ''
                debugLog('[POST-PANEL] In-page navigation to: ' + url)
                // Check if navigating to a post page (has /status/ in URL)
                if (url.includes('/status/')) {
                    debugLog('[POST-PANEL] Detected post navigation, re-triggering focus...')
                    // Re-trigger the focus logic after a delay for page to render
                    webview.executeJavaScript(`
                        (async function() {
                            console.log('[POST-PANEL] Re-triggering focus after navigation...');

                            const simulateClick = (el) => {
                                const rect = el.getBoundingClientRect();
                                const x = rect.left + rect.width / 2;
                                const y = rect.top + rect.height / 2;
                                const opts = { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y };
                                el.dispatchEvent(new MouseEvent('mousedown', opts));
                                el.dispatchEvent(new MouseEvent('mouseup', opts));
                                el.dispatchEvent(new MouseEvent('click', opts));
                            };

                            let focusAttempts = 0;
                            const tryFocusNav = async () => {
                                focusAttempts++;
                                console.log('[POST-PANEL] Navigation focus attempt', focusAttempts);

                                // First, try to click the reply placeholder to expand the composer
                                const replyPlaceholders = [
                                    '[data-testid="tweetTextarea_0RichTextInputContainer"]',
                                    '[data-testid="toolBar"] ~ div [role="textbox"]',
                                    '[placeholder="Post your reply"]',
                                    '[aria-label="Post your reply"]',
                                    '[data-text="true"]'
                                ];
                                let clickedPlaceholder = false;
                                for (const sel of replyPlaceholders) {
                                    const placeholder = document.querySelector(sel);
                                    if (placeholder) {
                                        console.log('[POST-PANEL] Nav: Scrolling and clicking placeholder:', sel);
                                        placeholder.scrollIntoView({ behavior: 'instant', block: 'center' });
                                        await new Promise(r => setTimeout(r, 50));
                                        simulateClick(placeholder);
                                        clickedPlaceholder = true;
                                        break;
                                    }
                                }

                                if (clickedPlaceholder) {
                                    await new Promise(r => setTimeout(r, 200));
                                }

                                // Now find and focus the composer
                                const selectors = [
                                    '[data-testid="tweetTextarea_0"]',
                                    '[data-testid="tweetTextarea_0_label"]',
                                    '[role="textbox"][data-testid]',
                                    '.public-DraftEditor-content',
                                    '[contenteditable="true"]'
                                ];

                                let composer = null;
                                for (const sel of selectors) {
                                    composer = document.querySelector(sel);
                                    if (composer) {
                                        console.log('[POST-PANEL] Nav: Found composer:', sel);
                                        break;
                                    }
                                }

                                if (composer) {
                                    console.log('[POST-PANEL] Nav: Scrolling and focusing composer...');
                                    composer.scrollIntoView({ behavior: 'instant', block: 'center' });
                                    await new Promise(r => setTimeout(r, 100));
                                    simulateClick(composer);
                                    composer.focus();
                                    console.log('[POST-PANEL] Nav: Focused composer!');
                                } else if (focusAttempts < 15) {
                                    console.log('[POST-PANEL] Nav: Composer not found, retrying...');
                                    setTimeout(tryFocusNav, 300);
                                } else {
                                    console.log('[POST-PANEL] Nav: Gave up finding composer');
                                }
                            };

                            // Start trying after delay for page to load
                            setTimeout(tryFocusNav, 500);
                        })();
                    `).catch((err: unknown) => debugLog('[POST-PANEL] Nav focus error: ' + err))
                }
            }
            webview.addEventListener('did-navigate-in-page', handleInPageNavigation)
            webview._postPanelInPageNav = handleInPageNavigation

            debugLog('[POST-PANEL-REF] dom-ready and navigation listeners added')

            // Also trigger after a delay as fallback (in case dom-ready already fired)
            setTimeout(() => {
                if (!postWebviewReadyRef.current && webview) {
                    debugLog('[POST-PANEL-REF] Fallback trigger - calling handleDomReady')
                    handleDomReady()
                }
            }, 500)
        }

        // Handle unmount - reset refs
        if (!webview) {
            postListenersSetupRef.current = false
            postWebviewReadyRef.current = false
        }
    }, [])

    // Inject CSS and JS helpers
    const injectHelpers = useCallback((webview: any) => {
        console.log('[INJECT] Injecting helpers...')

        // Only inject CSS once per webview instance to avoid accumulation
        if (!cssInjectedRef.current) {
            console.log('[INJECT] Injecting CSS (first time)...')
            cssInjectedRef.current = true
            webview.insertCSS(`
      #placeholder { display: none !important; }
      [data-testid="sidebarColumn"] { display: none !important; }
      [aria-label="Timeline: Trending now"] { display: none !important; }
      [aria-label="Who to follow"] { display: none !important; }
      [data-testid="primaryColumn"] {
        max-width: 100% !important;
        width: 100% !important;
        border-right: none !important;
      }
      [data-testid="placementTracking"] { display: none !important; }
      .parallax-hover {
        background: rgba(29, 155, 240, 0.15) !important;
        outline: 2px solid rgba(29, 155, 240, 0.6) !important;
        outline-offset: -2px;
        border-radius: 12px;
      }
      body.parallax-chat-expand [data-testid="DmScrollerContainer"] {
        height: auto !important;
        max-height: none !important;
        overflow: visible !important;
      }
      body.parallax-chat-expand [data-testid="DmScrollerContainer"] > div {
        height: auto !important;
        max-height: none !important;
        overflow: visible !important;
        transform: none !important;
      }
      /* Force GPU compositing layer for video rendering in webviews */
      video {
        will-change: transform !important;
        transform: translateZ(0) !important;
        -webkit-transform: translateZ(0) !important;
      }
    `).catch((err: unknown) => console.log('[INJECT] CSS injection error:', err))
        }

        // Inject JavaScript
        webview.executeJavaScript(`
      (function() {
        console.log('[WEBVIEW] Parallax helper injection running...');

        // === SCROLL POSITION & AUTO-FOCUS (always runs) ===
        // These need to run on every navigation, not just first init

        // Initialize scroll position storage (using sessionStorage to persist across reloads)
        // Key format: 'parallax_scroll_' + pathname
        
        // Find the element that is ACTUALLY scrolled
        function findScrollContainer(startElement) {
            // First check window scroll
            if (window.scrollY > 0) {
                return 'window';
            }

            // Then check elements starting from the click target
            let el = startElement;
            while (el && el !== document.body) {
                if (el.scrollTop > 0) {
                    return el;
                }
                // Also check if it's potentially scrollable even if at top (for 0 restoration)
                const style = window.getComputedStyle(el);
                if ((style.overflowY === 'auto' || style.overflowY === 'scroll') && el.scrollHeight > el.clientHeight) {
                     // Keep track of this as a candidate but prefer one with >0 scroll
                }
                el = el.parentElement;
            }
            
            // Fallback to searching known containers if we didn't start from a click or found nothing
            const selectors = [
                '[data-testid="primaryColumn"]',
                'main[role="main"]',
                '[role="main"]',
                'div[style*="overflow"]'
            ];
            
            for (const sel of selectors) {
                const candidates = document.querySelectorAll(sel);
                for (const candidate of candidates) {
                     // Check candidate
                     if (candidate.scrollTop > 0) return candidate;
                     // Check parent
                     if (candidate.parentElement?.scrollTop > 0) return candidate.parentElement;
                }
            }
            
            return null;
        }

        // Save scroll position for current page
        function saveScrollPosition(clickedElement) {
          const url = window.location.pathname;
          
          // Try to find what's scrolled
          const scroller = findScrollContainer(clickedElement);
          
          let value = 0;
          let type = 'element'; // 'window' or 'element'
          let selector = ''; // unique selector if possible
          
          if (scroller === 'window') {
              value = window.scrollY;
              type = 'window';
              console.log('[SCROLL] Detected WINDOW scroll:', value);
          } else if (scroller && scroller.tagName) {
              value = scroller.scrollTop;
              type = 'element';
              // Generate a simple unique-ish selector
              selector = scroller.tagName.toLowerCase();
              if (scroller.id) selector += '#' + scroller.id;
              if (scroller.className) selector += '.' + scroller.className.split(' ').join('.');
              // Fallback for unidentified divs
              if (selector === 'div' || selector === 'main') {
                  const testId = scroller.getAttribute('data-testid');
                  if (testId) selector += \`[data-testid="\${testId}"]\`;
              }
              console.log('[SCROLL] Detected ELEMENT scroll:', selector, value);
          } else {
              console.log('[SCROLL] No scrollable container found with >0 scroll. Assuming 0.');
          }

          const data = { value, type, selector };
          const key = 'parallax_scroll_' + url;
          sessionStorage.setItem(key, JSON.stringify(data));
          console.log('[SCROLL] Saved:', url, JSON.stringify(data));
        }

        // Restore scroll position for current page
        // For infinite scroll pages, we need to scroll incrementally to trigger content loading
        function restoreScrollPosition() {
          const url = window.location.pathname;
          const key = 'parallax_scroll_' + url;
          const savedDataStr = sessionStorage.getItem(key);

          if (!savedDataStr) return;

          let savedData;
          try {
              savedData = JSON.parse(savedDataStr);
          } catch {
              // Handle legacy format (just number)
              savedData = { value: parseInt(savedDataStr, 10), type: 'element' };
          }

          const { value, type, selector } = savedData;
          console.log('[SCROLL] Restoring:', url, JSON.stringify(savedData));

          if (value > 0) {
            let attempts = 0;
            let lastScrollPos = -1; // Start at -1 to not count first check as stuck
            let stuckCount = 0;
            let contentWaitAttempts = 0;
            const maxContentWait = 20; // Wait up to 2 seconds for content to appear

            const tryRestore = () => {
              // First, check if page content has loaded (look for article elements)
              const hasContent = document.querySelectorAll('article').length > 0;
              const pageHeight = document.documentElement.scrollHeight;

              if (!hasContent || pageHeight < 1000) {
                  contentWaitAttempts++;
                  if (contentWaitAttempts < maxContentWait) {
                      console.log('[SCROLL] Waiting for content... attempt:', contentWaitAttempts, 'height:', pageHeight, 'articles:', document.querySelectorAll('article').length);
                      setTimeout(tryRestore, 100);
                      return;
                  }
                  console.log('[SCROLL] Content wait timeout, proceeding anyway');
              }

              let currentPos = 0;
              let maxScroll = 0;

              if (type === 'window') {
                  // For infinite scroll, scroll incrementally to trigger content loading
                  currentPos = window.scrollY;
                  maxScroll = document.documentElement.scrollHeight - window.innerHeight;

                  if (currentPos < value) {
                      // Scroll towards target - use smaller jumps at first to let content load
                      const jumpSize = Math.min(value - currentPos, attempts < 5 ? 500 : 1500);
                      window.scrollTo({ top: currentPos + jumpSize, behavior: 'instant' });
                  } else {
                      // Fine-tune to exact position
                      window.scrollTo({ top: value, behavior: 'instant' });
                  }

                  currentPos = window.scrollY;
              } else {
                  // Element-based scrolling
                  let scroller;
                  if (selector) {
                      try { scroller = document.querySelector(selector); } catch {}
                  }
                  if (!scroller) {
                      scroller = findScrollContainer(null);
                      if (scroller === 'window') scroller = null;
                  }

                  if (scroller) {
                      currentPos = scroller.scrollTop;
                      maxScroll = scroller.scrollHeight - scroller.clientHeight;

                      if (currentPos < value) {
                          const jumpSize = Math.min(value - currentPos, attempts < 5 ? 500 : 1500);
                          scroller.scrollTop = currentPos + jumpSize;
                      } else {
                          scroller.scrollTop = value;
                      }
                      currentPos = scroller.scrollTop;
                  }
              }

              // Check if we reached the target (within 100px tolerance for infinite scroll)
              const reached = Math.abs(currentPos - value) < 100;

              if (reached) {
                  console.log('[SCROLL] Restore success! At:', currentPos, 'Target:', value);
                  return;
              }

              // Check if we're stuck (page hasn't loaded more content)
              if (currentPos === lastScrollPos) {
                  stuckCount++;
              } else {
                  stuckCount = 0;
              }
              lastScrollPos = currentPos;

              attempts++;

              // Be more patient when stuck at position 0 - content may still be loading
              const stuckThreshold = currentPos === 0 ? 15 : 8;

              if (stuckCount >= stuckThreshold) {
                  console.log('[SCROLL] Stuck at:', currentPos, '- content may not load further. Target was:', value);
                  return;
              }

              // Continue trying for longer on infinite scroll pages (up to 15 seconds)
              if (attempts < 75) {
                // Slower interval when waiting for content at position 0
                const delay = currentPos === 0 ? 250 : 200;
                setTimeout(tryRestore, delay);
              } else {
                  console.log('[SCROLL] Max attempts reached. At:', currentPos, 'Target:', value);
              }
            };
            // Wait a bit longer for initial page render
            setTimeout(tryRestore, 100);
          }
        }

        // Auto-focus the reply composer on post pages
        function autoFocusComposer() {
          const isPostPage = /\\/status\\/\\d+/.test(window.location.pathname);
          console.log('[FOCUS] Checking auto-focus, isPostPage:', isPostPage);
          if (isPostPage) {
            let attempts = 0;
            const tryFocus = async () => {
              const composer = document.querySelector('[data-testid="tweetTextarea_0"]');
              console.log('[FOCUS] Attempt', attempts, 'composer:', !!composer);
              if (composer) {
                // Scroll into view first to ensure visibility even with large images
                composer.scrollIntoView({ behavior: 'instant', block: 'center' });
                await new Promise(r => setTimeout(r, 100));
                composer.focus();
                // Also try clicking it as some frameworks require that
                composer.click();
                console.log('[FOCUS] Scrolled and Focused/Clicked composer');
                return;
              }
              attempts++;
              if (attempts < 15) {
                setTimeout(tryFocus, 300);
              }
            };
            setTimeout(tryFocus, 500);
          }
        }

        // Set up click listener for saving scroll position AND split view interception (only once)
        if (!window.parallaxClickListenerAdded) {
          window.parallaxClickListenerAdded = true;
          // Use capture phase to intercept clicks before React/Router handles them
          document.addEventListener('click', (e) => {
            // Check if the clicked element or any parent is a tweet link
            // Expanded selectors to catch more link types
            const link = e.target.closest('a[href*="/status/"], [data-testid="tweet"]');
            if (link) {
              console.log('[SCROLL] Click detected on:', link.tagName);
              saveScrollPosition(e.target);

              // === SPLIT VIEW INTERCEPTION ===
              // Check if we should intercept this click for split view
              const currentPath = window.location.pathname;
              const shouldIntercept = /^\\/(notifications|home)$/.test(currentPath) || /^\\/i\\/lists\\//.test(currentPath);
              console.log('[SPLIT] Check intercept: path=' + currentPath + ' shouldIntercept=' + shouldIntercept);

              if (shouldIntercept) {
                // IMPORTANT: Don't intercept clicks on action buttons (like, retweet, reply, bookmark, share, etc.)
                const actionButton = e.target.closest('[data-testid="like"], [data-testid="unlike"], [data-testid="retweet"], [data-testid="unretweet"], [data-testid="reply"], [data-testid="bookmark"], [data-testid="removeBookmark"], [data-testid="share"], [data-testid="caret"], [role="button"][aria-label*="Like"], [role="button"][aria-label*="Repost"], [role="button"][aria-label*="Reply"], [role="button"][aria-label*="Bookmark"], [role="button"][aria-label*="Share"]');
                if (actionButton) {
                  console.log('[SPLIT] Click on action button, NOT intercepting');
                  return; // Let the action button work normally
                }

                // Find the article element
                const article = e.target.closest('article[data-testid="tweet"]');
                if (article) {
                  // Find the post URL from the timestamp link (always present)
                  // The timestamp link has href like "/username/status/123"
                  const timeLink = article.querySelector('a[href*="/status/"] time')?.closest('a');
                  const href = timeLink ? timeLink.getAttribute('href') : null;
                  console.log('[SPLIT] Article clicked, timeLink href:', href);

                  // Check if it's a post URL (not photo/video modal)
                  const isPostUrl = href && /^\\/[^/]+\\/status\\/\\d+$/.test(href);

                  if (isPostUrl) {
                    console.log('[SPLIT] Intercepting post click for split view:', href);
                    e.preventDefault();
                    e.stopPropagation();
                    e.stopImmediatePropagation();
                    // Send message to parent to open in split panel
                    console.log('[SPLIT_VIEW_REQUEST]' + JSON.stringify({ url: 'https://x.com' + href }));
                    return false;
                  }
                }
              }
            }
          }, true); // Capture phase is CRITICAL here

          // Click-to-focus: when clicking on a post, focus the reply composer
          document.addEventListener('click', async (e) => {
            const article = e.target.closest('article[data-testid="tweet"]');
            if (!article) return;

            // Don't interfere with interactive elements
            const interactiveEl = e.target.closest('a, button, [role="button"], [data-testid="like"], [data-testid="retweet"], [data-testid="reply"], [role="textbox"], [contenteditable="true"]');
            if (interactiveEl) return;

            // Only focus if we're on a post page (not home/notifications)
            const isPostPage = /\\/status\\/\\d+/.test(window.location.pathname);
            if (!isPostPage) return;

            console.log('[FOCUS] Click on post detected, focusing reply...');
            await new Promise(r => setTimeout(r, 100));

            const composer = document.querySelector('[data-testid="tweetTextarea_0"]');
            if (composer) {
              composer.scrollIntoView({ behavior: 'instant', block: 'center' });
              await new Promise(r => setTimeout(r, 50));
              composer.focus();
              composer.click();
              console.log('[FOCUS] Click: Scrolled and focused composer');
            }
          }, true);

          console.log('[SCROLL] Click listener added (capture phase)');
        }

        // Check if we just navigated back (URL changed)
        const currentUrl = window.location.href;
        
        // Always try to restore scroll if we have data for this URL
        // We don't need to be fancy about "back detection" because if the user 
        // explicitly clicks a link to get here, X/Twitter will usually reset scroll anyway.
        // But if we have a saved position, it feels better to restore it.
        // Or we can check if it's NOT a post page.
        
        const isPostPage = /\\/status\\/\\d+/.test(window.location.pathname);
        if (!isPostPage) {
             console.log('[SCROLL] Not a post page, attempting restore...');
             restoreScrollPosition();
        }

        window.parallaxLastUrl = currentUrl;

        // Always try auto-focus on post pages
        autoFocusComposer();

        // === EVENT LISTENERS (only set up once) ===
        if (window.parallaxReady) {
          console.log('[WEBVIEW] Event listeners already set up, skipping');
          return;
        }
        console.log('[WEBVIEW] Setting up event listeners...');

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
            // Clear hover text when mouse is NOT over an article
            window.hoveredTweetText = null;
            window.targetArticle = null;
          }

          window.updateHighlight();
        }, true);

        window.updateHighlight = function() {
          const article = window.lastArticleUnderMouse;
          if (!window.isCtrlPressed) {
            if (window.currentHoveredArticle) {
              window.currentHoveredArticle.classList.remove('parallax-hover');
              window.currentHoveredArticle = null;
            }
            return;
          }
          if (!article) {
            if (window.currentHoveredArticle) {
              window.currentHoveredArticle.classList.remove('parallax-hover');
              window.currentHoveredArticle = null;
            }
            return;
          }
          if (article !== window.currentHoveredArticle) {
            if (window.currentHoveredArticle) {
              window.currentHoveredArticle.classList.remove('parallax-hover');
            }
            window.currentHoveredArticle = article;
            article.classList.add('parallax-hover');
          }
        }

        // Only track LEFT Ctrl (location === 1) for AI replies
        // Right Ctrl passes through for standard X/Twitter behavior
        document.addEventListener('keydown', (e) => {
          if (e.key === 'Control' && e.location === 1 && !window.isCtrlPressed) {
            window.isCtrlPressed = true;
            window.updateHighlight();
          }
        }, true);

        document.addEventListener('keyup', (e) => {
          if (e.key === 'Control' && e.location === 1) {
            window.isCtrlPressed = false;
            window.updateHighlight();
          }
        }, true);

        window.addEventListener('keydown', (e) => {
          if (e.key === 'Control' && e.location === 1 && !window.isCtrlPressed) {
            window.isCtrlPressed = true;
            window.updateHighlight();
          }
        }, true);

        window.addEventListener('keyup', (e) => {
          if (e.key === 'Control' && e.location === 1) {
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
          document.querySelectorAll('.parallax-hover').forEach(el => el.classList.remove('parallax-hover'));
          return true;
        };

        document.addEventListener('keydown', (e) => {
          if (e.key === 'Escape') {
            const backBtn = document.querySelector('[data-testid="app-bar-back"]') ||
                            document.querySelector('[aria-label="Back"]') ||
                            document.querySelector('button[aria-label*="Back"]');
            if (backBtn) { backBtn.click(); e.preventDefault(); }
          }

          // Ctrl+Shift+E: Expand/load all DM chat messages
          if (e.ctrlKey && e.shiftKey && e.key === 'E') {
            e.preventDefault();
            console.log('[CHAT] Expanding chat history...');
            console.log('[CHAT] Current URL:', window.location.href);

            // Check if we're in a DM conversation
            const isDM = window.location.href.includes('/messages/');
            if (!isDM) {
              console.log('[CHAT] Not in a DM URL');
              alert('Not in a DM conversation. Navigate to Messages first.');
              return;
            }

            // Log all potential containers for debugging
            console.log('[CHAT] Looking for scrollable containers...');
            const allScrollables = document.querySelectorAll('[style*="overflow"], [class*="scroll"]');
            console.log('[CHAT] Found scrollable elements:', allScrollables.length);

            // Find the main conversation area - look for the scrollable section
            let scroller = null;
            const potentialScrollers = [
              ...document.querySelectorAll('section[role="region"]'),
              ...document.querySelectorAll('[data-testid*="Dm"]'),
              ...document.querySelectorAll('[data-testid*="dm"]'),
              ...document.querySelectorAll('[data-testid*="conversation"]'),
              ...document.querySelectorAll('[aria-label*="message"]'),
              ...document.querySelectorAll('[aria-label*="Message"]'),
              ...document.querySelectorAll('main section'),
              ...document.querySelectorAll('[role="main"] section'),
            ];

            console.log('[CHAT] Potential scrollers found:', potentialScrollers.length);
            potentialScrollers.forEach((el, i) => {
              console.log('[CHAT] Scroller', i, ':', el.tagName, el.getAttribute('data-testid'), el.getAttribute('aria-label'));
            });

            // Find the one with scrollable content
            for (const el of potentialScrollers) {
              if (el.scrollHeight > el.clientHeight) {
                scroller = el;
                console.log('[CHAT] Found scrollable container:', el.tagName, el.getAttribute('data-testid'));
                break;
              }
            }

            // Fallback: just find any scrollable div in main content area
            if (!scroller) {
              const mainArea = document.querySelector('[role="main"]') || document.querySelector('main') || document.body;
              const divs = mainArea.querySelectorAll('div');
              for (const div of divs) {
                if (div.scrollHeight > div.clientHeight + 100 && div.clientHeight > 200) {
                  scroller = div;
                  console.log('[CHAT] Found scrollable div fallback');
                  break;
                }
              }
            }

            if (!scroller) {
              console.log('[CHAT] No scrollable container found');
              alert('Could not find chat container. Try scrolling manually first, then press Ctrl+Shift+E again.');
              return;
            }

            // Auto-scroll to load all messages
            window.parallaxChatExpand = async () => {
              let lastScrollTop = -1;
              let iterations = 0;
              const maxIterations = 500; // Safety limit

              console.log('[CHAT] Starting auto-scroll to load all messages...');
              console.log('[CHAT] Container scrollHeight:', scroller.scrollHeight, 'clientHeight:', scroller.clientHeight);

              // Scroll to top repeatedly to load older messages
              while (iterations < maxIterations) {
                const prevScrollHeight = scroller.scrollHeight;
                scroller.scrollTop = 0; // Scroll to very top
                await new Promise(r => setTimeout(r, 400));

                // Check if more content loaded
                if (scroller.scrollHeight === prevScrollHeight && scroller.scrollTop === 0) {
                  // Wait a bit more and check again
                  await new Promise(r => setTimeout(r, 800));
                  if (scroller.scrollHeight === prevScrollHeight) {
                    console.log('[CHAT] No more content loading, stopping');
                    break;
                  }
                }

                iterations++;
                if (iterations % 10 === 0) {
                  console.log('[CHAT] Scroll iteration', iterations, '- scrollHeight:', scroller.scrollHeight);
                }
              }

              console.log('[CHAT] Finished loading after', iterations, 'iterations. Extracting messages...');

              // Now extract all visible text from the conversation
              const messages = [];
              const seen = new Set();

              // Get all text-containing elements in the scroller
              const textEls = scroller.querySelectorAll('span, div[dir="auto"], [data-testid*="tweet"], [data-testid*="message"]');
              console.log('[CHAT] Found', textEls.length, 'text elements');

              textEls.forEach(el => {
                // Skip if this element contains other text elements (to avoid duplication)
                if (el.querySelector('span, div[dir="auto"]')) return;

                const text = el.innerText?.trim();
                if (text && text.length > 0 && !seen.has(text)) {
                  seen.add(text);
                  messages.push(text);
                }
              });

              const fullText = messages.join('\\n');
              console.log('[CHAT] Extracted', messages.length, 'unique text segments');
              console.log('[CHAT] Total characters:', fullText.length);

              // Copy to clipboard
              try {
                await navigator.clipboard.writeText(fullText);
                alert('Chat copied! ' + messages.length + ' segments, ' + fullText.length + ' chars');
              } catch (err) {
                console.error('[CHAT] Clipboard write failed:', err);
                // Fallback: create a temporary textarea
                const ta = document.createElement('textarea');
                ta.value = fullText;
                document.body.appendChild(ta);
                ta.select();
                document.execCommand('copy');
                document.body.removeChild(ta);
                alert('Chat copied (fallback)! ' + messages.length + ' segments');
              }
            };

            window.parallaxChatExpand();
          }
        }, true);

        // Clipboard paste interception for image support
        window.pendingPasteRequests = {};
        window.pasteInProgress = false;

        window.addEventListener('message', (event) => {
          if (event.data && event.data.type === 'clipboard-paste-response') {
            const { requestId, dataType, data } = event.data;
            const resolver = window.pendingPasteRequests[requestId];
            if (resolver) {
              resolver({ dataType, data });
              delete window.pendingPasteRequests[requestId];
            }
          }
        });

        // Handle Ctrl+V directly via keydown to ensure it's not blocked
        document.addEventListener('keydown', async (e) => {
          if ((e.ctrlKey || e.metaKey) && e.key === 'v' && !window.pasteInProgress) {
            const activeEl = document.activeElement;
            const isInComposer = activeEl && (
              activeEl.matches('[data-testid="tweetTextarea_0"], [data-testid="tweetTextarea_1"], [role="textbox"], [contenteditable="true"]') ||
              activeEl.closest('[data-testid="tweetTextarea_0"], [data-testid="tweetTextarea_1"], [role="textbox"], [contenteditable="true"]')
            );

            if (!isInComposer) return;

            console.log('[CLIPBOARD] Ctrl+V detected in composer, requesting clipboard data...');
            window.pasteInProgress = true;

            const requestId = Date.now() + '_' + Math.random().toString(36).slice(2);

            const clipboardPromise = new Promise((resolve) => {
              window.pendingPasteRequests[requestId] = resolve;
              setTimeout(() => {
                if (window.pendingPasteRequests[requestId]) {
                  delete window.pendingPasteRequests[requestId];
                  resolve(null);
                }
              }, 2000);
            });

            console.log('[CLIPBOARD_REQUEST]', JSON.stringify({ type: 'clipboard-paste-request', requestId }));

            const result = await clipboardPromise;
            window.pasteInProgress = false;

            if (result && result.dataType === 'image' && result.data) {
              e.preventDefault();
              e.stopPropagation();

              try {
                console.log('[CLIPBOARD] Processing image data, length:', result.data.length);
                // Convert data URL to blob without using fetch (which may be blocked by CSP)
                const dataUrl = result.data;
                const parts = dataUrl.split(',');
                const mimeMatch = parts[0].match(/:(.*?);/);
                const mime = mimeMatch ? mimeMatch[1] : 'image/png';
                const bstr = atob(parts[1]);
                let n = bstr.length;
                const u8arr = new Uint8Array(n);
                while (n--) {
                  u8arr[n] = bstr.charCodeAt(n);
                }
                const blob = new Blob([u8arr], { type: mime });
                console.log('[CLIPBOARD] Blob created, size:', blob.size, 'type:', blob.type);
                const file = new File([blob], 'pasted-image.png', { type: 'image/png' });
                console.log('[CLIPBOARD] File created, size:', file.size);

                const dt = new DataTransfer();
                dt.items.add(file);

                // Find ALL file inputs - there may be multiple (reply composer vs main composer modal)
                const fileInputs = document.querySelectorAll('input[type="file"][accept*="image"]');
                console.log('[CLIPBOARD] Found file inputs:', fileInputs.length);

                // Try each file input
                fileInputs.forEach((fileInput, idx) => {
                  try {
                    console.log('[CLIPBOARD] Trying file input', idx, fileInput.getAttribute('data-testid'));
                    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'files').set;
                    nativeInputValueSetter.call(fileInput, dt.files);
                    fileInput.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
                    fileInput.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
                  } catch (err) {
                    console.log('[CLIPBOARD] File input', idx, 'failed:', err);
                  }
                });

                // Find the active composer (could be main tweet box or reply modal)
                const composers = document.querySelectorAll('[data-testid="tweetTextarea_0"], [data-testid="tweetTextarea_1"]');
                console.log('[CLIPBOARD] Found composers:', composers.length);

                composers.forEach((composer, idx) => {
                  // Find the closest container that handles drops
                  const dropTarget = composer.closest('[data-testid="toolBar"]')?.parentElement ||
                                     composer.closest('[role="dialog"]') ||
                                     composer.closest('[data-testid="primaryColumn"]') ||
                                     composer.parentElement;

                  if (dropTarget) {
                    console.log('[CLIPBOARD] Dispatching drop to composer', idx);
                    dropTarget.dispatchEvent(new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer: dt }));
                    dropTarget.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
                    dropTarget.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
                  }
                });

              } catch (err) {
                console.error('[CLIPBOARD] Error processing image:', err);
              }
            } else if (result && result.dataType === 'text' && result.data) {
              // For text, let the default paste happen or insert manually
              console.log('[CLIPBOARD] Text paste, inserting:', result.data.slice(0, 50));
              document.execCommand('insertText', false, result.data);
              e.preventDefault();
            }
            // If no result or not image, let default paste behavior continue
          }
        }, true);

        window.parallaxReady = true;
        console.log('[WEBVIEW] Parallax helper initialized successfully!');
      })();
    `).then(() => {
            console.log('[INJECT] JS injection complete!')
            setWebviewReady(true)
            webviewReadyRef.current = true
        }).catch((err: unknown) => {
            console.log('[INJECT] JS injection failed:', err)
        })
    }, [])

    const handleRegenerate = () => {
        if (!hoveredTweet || isRegenerating) return
        setIsRegenerating(true)
        generatingForRef.current = null // Force regeneration
        generateReplies(hoveredTweet.text, customPrompt || undefined).finally(() => {
            setIsRegenerating(false)
        })
    }

    // Listen for paste trigger from Electron menu and forward to webview
    useEffect(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const electronAPI = (window as any).electronAPI
        if (electronAPI && electronAPI.onTriggerPaste) {
            electronAPI.onTriggerPaste(async () => {
                console.log('[PASTE] Menu paste triggered, forwarding to webview...')
                const webview = webviewRef.current
                if (!webview || !webviewReadyRef.current) {
                    console.log('[PASTE] Webview not ready')
                    return
                }

                // Trigger paste handling in webview by simulating keydown
                try {
                    await webview.executeJavaScript(`
                        (function() {
                            console.log('[PASTE] Received paste trigger from menu');
                            // Dispatch a synthetic Ctrl+V keydown event
                            const event = new KeyboardEvent('keydown', {
                                key: 'v',
                                code: 'KeyV',
                                ctrlKey: true,
                                bubbles: true,
                                cancelable: true
                            });
                            document.activeElement.dispatchEvent(event);
                        })();
                    `)
                } catch (err) {
                    console.error('[PASTE] Failed to trigger paste in webview:', err)
                }
            })
        }

        // Listen for chat export trigger from global shortcut
        if (electronAPI && electronAPI.onTriggerChatExport) {
            electronAPI.onTriggerChatExport(async () => {
                console.log('[CHAT] Global shortcut triggered chat export')
                const webview = webviewRef.current
                if (!webview || !webviewReadyRef.current) {
                    console.log('[CHAT] Webview not ready')
                    return
                }

                try {
                    // Get the folder path first
                    const folder = await electronAPI.getScreenshotsFolder()
                    alert(`Starting chat screenshot export...\n\nScreenshots will be saved to:\n${folder}\n\nClick OK to begin. This may take a while for long conversations.`)

                    // Create timestamp folder for this export
                    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
                    const exportFolder = `chat-export-${timestamp}`

                    // First, scroll to top to load all messages
                    await webview.executeJavaScript(`
                        (async function() {
                            // Find scrollable container
                            let scroller = null;
                            const allDivs = document.querySelectorAll('div');
                            for (const div of allDivs) {
                                const style = window.getComputedStyle(div);
                                if ((style.overflowY === 'auto' || style.overflowY === 'scroll') &&
                                    div.scrollHeight > div.clientHeight + 100 &&
                                    div.clientHeight > 200) {
                                    scroller = div;
                                    break;
                                }
                            }

                            if (!scroller) {
                                console.log('[CHAT] No scroller found');
                                return { error: 'no scroller' };
                            }

                            // Scroll to top to load all messages
                            console.log('[CHAT] Scrolling to top to load all messages...');
                            let prevHeight = 0;
                            let sameCount = 0;
                            while (sameCount < 3) {
                                scroller.scrollTop = 0;
                                await new Promise(r => setTimeout(r, 500));
                                if (scroller.scrollHeight === prevHeight) {
                                    sameCount++;
                                } else {
                                    sameCount = 0;
                                    prevHeight = scroller.scrollHeight;
                                }
                            }

                            // Store scroller info for later
                            window._chatScroller = scroller;
                            window._chatScrollHeight = scroller.scrollHeight;
                            window._chatClientHeight = scroller.clientHeight;

                            console.log('[CHAT] Ready for screenshots. Total height:', scroller.scrollHeight);
                            return {
                                totalHeight: scroller.scrollHeight,
                                viewportHeight: scroller.clientHeight
                            };
                        })();
                    `)

                    // Now take screenshots page by page
                    let pageNum = 0
                    let hasMore = true

                    while (hasMore) {
                        // Capture the current view
                        const image = await webview.capturePage()
                        const dataUrl = image.toDataURL()

                        // Save screenshot
                        const filename = `${exportFolder}/page-${String(pageNum).padStart(4, '0')}.png`
                        const saveResult = await electronAPI.saveScreenshot(dataUrl, filename)

                        if (!saveResult.success) {
                            console.error('[CHAT] Failed to save screenshot:', saveResult.error)
                        } else {
                            console.log('[CHAT] Saved page', pageNum)
                        }

                        // Scroll down by viewport height
                        const scrollResult = await webview.executeJavaScript(`
                            (function() {
                                const scroller = window._chatScroller;
                                if (!scroller) return { done: true };

                                const prevScroll = scroller.scrollTop;
                                scroller.scrollTop += scroller.clientHeight - 50; // Small overlap

                                // Check if we've reached the bottom
                                const atBottom = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 10;
                                const didntMove = scroller.scrollTop === prevScroll;

                                return {
                                    done: atBottom || didntMove,
                                    scrollTop: scroller.scrollTop,
                                    scrollHeight: scroller.scrollHeight
                                };
                            })();
                        `)

                        hasMore = !scrollResult.done
                        pageNum++

                        // Small delay to let content render
                        await new Promise(r => setTimeout(r, 300))

                        // Safety limit
                        if (pageNum > 1000) {
                            console.log('[CHAT] Hit page limit')
                            break
                        }
                    }

                    alert(`Chat export complete!\n\n${pageNum} screenshots saved to:\n${folder}/${exportFolder}`)

                } catch (err) {
                    console.error('[CHAT] Error:', err)
                    alert('Error exporting chat: ' + err)
                }
            })
        }
    }, [])

    // Handle clipboard messages from webview
    useEffect(() => {
        const handleClipboardMessage = async (event: MessageEvent) => {
            const webview = webviewRef.current
            if (!webview) return

            const { type, requestId } = event.data || {}

            if (type === 'clipboard-paste-request') {
                try {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    const electronAPI = (window as any).electronAPI
                    if (!electronAPI) {
                        console.error('[CLIPBOARD] electronAPI not available')
                        return
                    }

                    // Check for image first
                    const hasImage = await electronAPI.clipboardHasImage()
                    if (hasImage) {
                        const imageDataUrl = await electronAPI.clipboardReadImage()
                        if (imageDataUrl) {
                            webview.executeJavaScript(`
                                (function() {
                                    window.postMessage({
                                        type: 'clipboard-paste-response',
                                        requestId: '${requestId}',
                                        dataType: 'image',
                                        data: '${imageDataUrl}'
                                    }, '*');
                                })();
                            `)
                            return
                        }
                    }

                    // Fall back to text
                    const text = await electronAPI.clipboardReadText()
                    webview.executeJavaScript(`
                        (function() {
                            window.postMessage({
                                type: 'clipboard-paste-response',
                                requestId: '${requestId}',
                                dataType: 'text',
                                data: ${JSON.stringify(text)}
                            }, '*');
                        })();
                    `)
                } catch (error) {
                    console.error('[CLIPBOARD] Error handling paste request:', error)
                }
            } else if (type === 'clipboard-copy-request') {
                try {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    const electronAPI = (window as any).electronAPI
                    if (!electronAPI) return

                    const { dataType, data } = event.data
                    if (dataType === 'image') {
                        await electronAPI.clipboardWriteImage(data)
                    } else {
                        await electronAPI.clipboardWriteText(data)
                    }
                } catch (error) {
                    console.error('[CLIPBOARD] Error handling copy request:', error)
                }
            }
        }

        window.addEventListener('message', handleClipboardMessage)
        return () => window.removeEventListener('message', handleClipboardMessage)
    }, [])

    // Set up webview IPC message forwarding
    useEffect(() => {
        const webview = webviewRef.current
        if (!webview) return

        const handleIpcMessage = (event: any) => {
            const { channel, args } = event
            if (channel === 'clipboard-request') {
                window.postMessage(args[0], '*')
            }
        }

        webview.addEventListener('ipc-message', handleIpcMessage)
        return () => webview.removeEventListener('ipc-message', handleIpcMessage)
    }, [webviewReady])

    // Force dismiss AI replies popup
    const forceDismissPopup = useCallback(() => {
        console.log('[POPUP] Force dismissing popup')
        setHoveredTweet(null)
        setIsOverPanel(false)
        setReplies([])
        generatingForRef.current = null
        lastTextRef.current = null
        ctrlPressedRef.current = false
        setIsCtrlPressed(false)
        setCustomPrompt('')

        // Also clear Ctrl state in webviews so they don't immediately re-trigger
        const clearCtrlScript = `
            window.isCtrlPressed = false;
            window.hoveredTweetText = null;
            window.targetArticle = null;
            if (typeof window.updateHighlight === 'function') window.updateHighlight();
        `
        webviewRef.current?.executeJavaScript(clearCtrlScript).catch(() => {})
        postWebviewRef.current?.executeJavaScript(clearCtrlScript).catch(() => {})
    }, [])

    // Middle mouse button to force close popup
    useEffect(() => {
        const handleMouseDown = (e: MouseEvent) => {
            // Middle mouse button = button 1
            if (e.button === 1 && hoveredTweetRef.current) {
                e.preventDefault()
                forceDismissPopup()
            }
        }

        window.addEventListener('mousedown', handleMouseDown)
        return () => window.removeEventListener('mousedown', handleMouseDown)
    }, [forceDismissPopup])

    // Parent-level Ctrl tracking (works when parent has focus)
    // Only LEFT Ctrl triggers AI replies - Right Ctrl passes through for normal X behavior
    useEffect(() => {
        const handleKeyDown = async (e: KeyboardEvent) => {
            // Only track LEFT Ctrl (location 1) for AI popup
            // Right Ctrl (location 2) passes through to webview for normal X behavior
            if (e.key === 'Control' && e.location === 1) {
                ctrlPressedRef.current = true
                setIsCtrlPressed(true)
            }

            // Escape: First close AI popup if open, then close post panel
            if (e.key === 'Escape') {
                if (hoveredTweetRef.current) {
                    e.preventDefault()
                    forceDismissPopup()
                    return
                }
                if (postPanelUrlRef.current) {
                    e.preventDefault()
                    setPostPanelUrl(null)
                    return
                }
            }

            // Log all Ctrl+Shift combinations for debugging
            if (e.ctrlKey && e.shiftKey) {
                console.log('[KEY] Ctrl+Shift+' + e.key + ' pressed (code: ' + e.code + ')')
            }

            // Ctrl+Shift+E: Export DM chat history
            if (e.ctrlKey && e.shiftKey && (e.key === 'E' || e.key === 'e' || e.code === 'KeyE')) {
                e.preventDefault()
                console.log('[CHAT] Ctrl+Shift+E pressed - exporting chat')

                const webview = webviewRef.current
                if (!webview || !webviewReadyRef.current) {
                    console.log('[CHAT] Webview not ready')
                    return
                }

                try {
                    const result = await webview.executeJavaScript(`
                        (async function() {
                            console.log('[CHAT] Starting chat export...');
                            console.log('[CHAT] URL:', window.location.href);

                            // Log current URL for debugging
                            const url = window.location.href;
                            console.log('[CHAT] Current URL:', url);
                            
                            // Skip URL check - just try to find a conversation container
                            // This will work on any page with scrollable chat content

                            // Find scrollable container
                            let scroller = null;
                            const mainArea = document.querySelector('[role="main"]') || document.body;
                            const allDivs = mainArea.querySelectorAll('div');

                            for (const div of allDivs) {
                                const style = window.getComputedStyle(div);
                                const isScrollable = style.overflowY === 'auto' || style.overflowY === 'scroll';
                                const hasScroll = div.scrollHeight > div.clientHeight + 50;
                                const isBigEnough = div.clientHeight > 300;

                                if (isScrollable && hasScroll && isBigEnough) {
                                    scroller = div;
                                    console.log('[CHAT] Found scroller:', div.className?.slice(0, 50));
                                    break;
                                }
                            }

                            if (!scroller) {
                                return { error: 'Could not find chat scroll container.' };
                            }

                            // Scroll to top to load all messages
                            console.log('[CHAT] Scrolling to load all messages...');
                            let iterations = 0;
                            const maxIter = 300;

                            while (iterations < maxIter) {
                                const prevHeight = scroller.scrollHeight;
                                scroller.scrollTop = 0;
                                await new Promise(r => setTimeout(r, 300));

                                if (scroller.scrollHeight === prevHeight) {
                                    await new Promise(r => setTimeout(r, 500));
                                    if (scroller.scrollHeight === prevHeight) {
                                        break;
                                    }
                                }
                                iterations++;
                                if (iterations % 20 === 0) {
                                    console.log('[CHAT] Scroll iter', iterations);
                                }
                            }

                            console.log('[CHAT] Done scrolling after', iterations, 'iterations');

                            // Extract messages
                            const messages = [];
                            const seen = new Set();

                            // Get leaf text nodes
                            const walker = document.createTreeWalker(
                                scroller,
                                NodeFilter.SHOW_TEXT,
                                null,
                                false
                            );

                            let node;
                            while (node = walker.nextNode()) {
                                const text = node.textContent?.trim();
                                if (text && text.length > 0 && !seen.has(text)) {
                                    seen.add(text);
                                    messages.push(text);
                                }
                            }

                            console.log('[CHAT] Extracted', messages.length, 'text segments');

                            const fullText = messages.join('\\n');

                            // Copy to clipboard
                            try {
                                await navigator.clipboard.writeText(fullText);
                            } catch (e) {
                                const ta = document.createElement('textarea');
                                ta.value = fullText;
                                ta.style.position = 'fixed';
                                ta.style.opacity = '0';
                                document.body.appendChild(ta);
                                ta.select();
                                document.execCommand('copy');
                                document.body.removeChild(ta);
                            }

                            return {
                                success: true,
                                count: messages.length,
                                chars: fullText.length
                            };
                        })();
                    `)

                    console.log('[CHAT] Result:', result)

                    if (result.error) {
                        alert(result.error)
                    } else if (result.success) {
                        alert('Chat exported! ' + result.count + ' segments, ' + result.chars + ' characters copied to clipboard.')
                    }
                } catch (err) {
                    console.error('[CHAT] Error:', err)
                    alert('Error exporting chat: ' + err)
                }
            }
        }
        const handleKeyUp = (e: KeyboardEvent) => {
            // Only respond to LEFT Ctrl (location 1) release
            if (e.key === 'Control' && e.location === 1) {
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

    // Poll webview for state - runs continuously (checks both main and post panel webviews)
    useEffect(() => {
        console.log('[POLL] Setting up polling interval...')
        let pollCount = 0

        // Helper to poll a single webview
        const pollWebview = async (webview: any, isPostPanel: boolean): Promise<{ ctrl: boolean, text: string | null, x: number, y: number, helperReady: boolean } | null> => {
            try {
                const readyFlag = isPostPanel ? 'parallaxPostPanelReady' : 'parallaxReady'
                const result = await webview.executeJavaScript(`
                    (function() {
                        return {
                            ctrl: !!window.isCtrlPressed,
                            text: window.hoveredTweetText || null,
                            x: window.lastMouseX || 0,
                            y: window.lastMouseY || 0,
                            helperReady: !!window.${readyFlag}
                        };
                    })()
                `)
                return result
            } catch {
                return null
            }
        }

        const pollInterval = setInterval(async () => {
            const mainWebview = webviewRef.current
            const postWebview = postWebviewRef.current
            pollCount++

            // Log every 100 polls (every 5 seconds)
            if (pollCount % 100 === 0) {
                console.log(`[POLL ${pollCount}] main:`, !!mainWebview, 'mainReady:', webviewReadyRef.current, 'post:', !!postWebview, 'postReady:', postWebviewReadyRef.current)
            }

            // Poll both webviews in parallel
            const [mainResult, postResult] = await Promise.all([
                mainWebview && webviewReadyRef.current ? pollWebview(mainWebview, false) : Promise.resolve(null),
                postWebview && postWebviewReadyRef.current ? pollWebview(postWebview, true) : Promise.resolve(null)
            ])

            // Determine which webview has focus/hover (prefer post panel if it has hover text)
            let activeResult: { ctrl: boolean, text: string | null, x: number, y: number, helperReady: boolean } | null = null
            let activeSource: 'main' | 'post' = 'main'

            // Post panel takes priority if it has hovered text
            if (postResult && postResult.text) {
                activeResult = postResult
                activeSource = 'post'
            } else if (mainResult) {
                activeResult = mainResult
                activeSource = 'main'
            }

            if (!activeResult) {
                if (pollCount % 100 === 0) {
                    console.log('[POLL] No webview ready')
                }
                return
            }

            // Combine webview Ctrl with parent Ctrl (OR them)
            const webviewCtrl = activeResult.ctrl || (mainResult?.ctrl) || (postResult?.ctrl)
            const parentCtrl = ctrlPressedRef.current
            const newCtrlState = webviewCtrl || parentCtrl

            // Log Ctrl state changes
            if (newCtrlState && pollCount % 20 === 0) {
                console.log('[POLL] Ctrl pressed! source:', activeSource, 'text:', activeResult.text?.slice(0, 30))
            }

            // Push parent Ctrl state to both webviews if different
            if (parentCtrl) {
                if (mainWebview && mainResult && !mainResult.ctrl) {
                    mainWebview.executeJavaScript(`
                        window.isCtrlPressed = true;
                        if (typeof window.updateHighlight === 'function') window.updateHighlight();
                    `).catch(() => { })
                }
                if (postWebview && postResult && !postResult.ctrl) {
                    postWebview.executeJavaScript(`
                        window.isCtrlPressed = true;
                        if (typeof window.updateHighlight === 'function') window.updateHighlight();
                    `).catch(() => { })
                }
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

            // Clear popup if Ctrl pressed but no tweet is hovered
            if (newCtrlState && !activeResult.text && !isOverPanelRef.current) {
                if (hoveredTweetRef.current) {
                    console.log('[POLL] Ctrl pressed but no tweet hovered - clearing popup')
                    setHoveredTweet(null)
                    setReplies([])
                    generatingForRef.current = null
                    lastTextRef.current = null
                    setCustomPrompt('')
                }
                return
            }

            // Update hovered tweet if Ctrl is pressed
            if (newCtrlState && activeResult.text) {
                if (activeResult.text !== lastTextRef.current) {
                    // NEW tweet - set position once and track source
                    console.log('[POLL] NEW TWEET DETECTED from', activeSource + ':', activeResult.text.slice(0, 50), '...')
                    lastTextRef.current = activeResult.text
                    activeHoverWebviewRef.current = activeSource
                    setHoveredTweet({
                        id: Date.now().toString(),
                        text: activeResult.text,
                        x: activeResult.x,
                        y: activeResult.y
                    })
                    setCustomPrompt('')
                    if (generateRepliesRef.current) {
                        console.log('[POLL] Calling generateReplies...')
                        generateRepliesRef.current(activeResult.text)
                    } else {
                        console.log('[POLL] ERROR: generateRepliesRef.current is null!')
                    }
                }
            }
        }, 50)

        // Periodically check if helper is still alive and reinit if needed
        const healthCheck = setInterval(async () => {
            const webview = webviewRef.current
            if (!webview || !webviewReadyRef.current) return
            try {
                const ready = await webview.executeJavaScript(`!!window.parallaxReady`)
                if (!ready) {
                    console.log('[HEALTH] Parallax helper not ready, reinjecting...')
                    injectHelpers(webview)
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

        // Determine which webview to insert reply into
        const targetWebview = activeHoverWebviewRef.current === 'post'
            ? postWebviewRef.current
            : webviewRef.current
        const targetName = activeHoverWebviewRef.current

        console.log('[REPLY] Inserting reply into', targetName, 'webview')

        // Dismiss the panel immediately
        setHoveredTweet(null)
        setIsOverPanel(false)
        setReplies([])
        generatingForRef.current = null
        lastTextRef.current = null
        ctrlPressedRef.current = false
        setIsCtrlPressed(false)

        if (targetWebview) {
            try {
                await targetWebview.executeJavaScript(`window.insertReply(${JSON.stringify(reply)})`)
                console.log('[REPLY] Reply inserted successfully into', targetName)
            } catch (err) {
                console.error('[REPLY] Failed to insert reply into', targetName + ':', err)
            }
        } else {
            console.error('[REPLY] No target webview available')
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

    const handleNavigate = () => {
        const webview = webviewRef.current
        if (webview && urlInput) {
            let url = urlInput
            if (!url.startsWith('http://') && !url.startsWith('https://')) {
                url = 'https://' + url
            }
            webview.loadURL(url)
            setCurrentUrl(url)
        }
    }

    return (
        <div className="h-screen bg-black text-white overflow-hidden relative flex flex-col">
            {/* URL Bar */}
            <div className="flex items-center gap-2 px-3 py-2 bg-gray-900 border-b border-gray-700">
                <button
                    onClick={() => webviewRef.current?.goBack()}
                    className="px-2 py-1 text-gray-400 hover:text-white hover:bg-gray-700 rounded"
                >
                    ←
                </button>
                <button
                    onClick={() => webviewRef.current?.goForward()}
                    className="px-2 py-1 text-gray-400 hover:text-white hover:bg-gray-700 rounded"
                >
                    →
                </button>
                <button
                    onClick={() => webviewRef.current?.reload()}
                    className="px-2 py-1 text-gray-400 hover:text-white hover:bg-gray-700 rounded"
                >
                    ↻
                </button>
                <input
                    type="text"
                    value={urlInput}
                    onChange={(e) => setUrlInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleNavigate()}
                    className="flex-1 bg-gray-800 border border-gray-600 rounded px-3 py-1 text-sm text-white focus:outline-none focus:border-blue-500"
                    placeholder="Enter URL..."
                />
                <button
                    onClick={handleNavigate}
                    className="px-3 py-1 bg-blue-600 hover:bg-blue-500 rounded text-sm"
                >
                    Go
                </button>
            </div>

            {/* Main content area - split when post panel is open */}
            <div className="flex-1 flex">
                {/* Main webview (notifications/feed) */}
                <webview
                    ref={webviewCallbackRef}
                    src={currentUrl}
                    className={`flex-1 h-full ${postPanelUrl ? 'w-1/2' : 'w-full'}`}
                    style={{ transition: 'width 0.2s ease-out' }}
                    {...{
                        allowpopups: 'true',
                        partition: 'persist:x',
                        plugins: 'true',
                        webpreferences: 'contextIsolation=no, javascript=yes, images=yes, plugins=yes, webSecurity=yes'
                    } as any}
                />

                {/* Post panel webview - shows when a post is opened */}
                {postPanelUrl && (
                    <div className="w-1/2 h-full flex flex-col border-l border-gray-700 relative">
                        {/* Close button */}
                        <button
                            onClick={() => setPostPanelUrl(null)}
                            className="absolute top-2 right-2 z-10 p-1.5 bg-gray-800/90 hover:bg-gray-700 rounded-full text-gray-400 hover:text-white transition-colors"
                            title="Close panel (Esc)"
                        >
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                        </button>
                        <webview
                            ref={postWebviewCallbackRef}
                            src={postPanelUrl}
                            className="flex-1 w-full h-full"
                            {...{
                                allowpopups: 'true',
                                partition: 'persist:x',
                                plugins: 'true',
                                webpreferences: 'contextIsolation=no, javascript=yes, images=yes, plugins=yes, webSecurity=yes'
                            } as any}
                        />
                    </div>
                )}
            </div>

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
                        onMouseDown={(e) => {
                            // Middle mouse button (button 1) closes popup
                            if (e.button === 1) {
                                e.preventDefault()
                                forceDismissPopup()
                            }
                        }}
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
                                        <span className="text-sm font-semibold text-blue-400">Replies</span>
                                    </div>
                                    <div className="flex items-center gap-1">
                                        <button
                                            onClick={handleRegenerate}
                                            disabled={isRegenerating}
                                            className="p-1.5 hover:bg-white/10 rounded-lg transition-colors disabled:opacity-50"
                                            title="Regenerate"
                                        >
                                            <RefreshCw className={`w-4 h-4 text-blue-400 ${isRegenerating ? 'animate-spin' : ''}`} />
                                        </button>
                                        <button
                                            onClick={forceDismissPopup}
                                            className="p-1.5 hover:bg-white/10 rounded-lg transition-colors"
                                            title="Close (Esc or Middle-click)"
                                        >
                                            <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                            </svg>
                                        </button>
                                    </div>
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
