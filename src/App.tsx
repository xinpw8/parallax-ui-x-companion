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
        const message = event.message
        // Log all webview console messages for debugging
        if (message && (message.startsWith('[CLIPBOARD') || message.startsWith('[PASTE'))) {
            console.log('[RENDERER] Webview console:', message)
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

            // Set up console-message listener for clipboard requests
            webview.addEventListener('console-message', handleConsoleMessage)

            // Also check if already loaded
            setTimeout(() => {
                if (!webviewInitializedRef.current && webview.getURL && webview.getURL()) {
                    console.log('[REF] Webview already has URL, initializing now')
                    initializeWebview(webview)
                }
            }, 100)
        }
    }, [handleConsoleMessage])

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

      .parallax-hover {
        background: rgba(29, 155, 240, 0.15) !important;
        outline: 2px solid rgba(29, 155, 240, 0.6) !important;
        outline-offset: -2px;
        border-radius: 12px;
      }

      /* When chat expand mode is active, disable virtualization */
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
    `)

        // Inject JavaScript
        webview.executeJavaScript(`
      (function() {
        console.log('[WEBVIEW] Initializing Parallax helper...');

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

    // Parent-level Ctrl tracking (works when parent has focus)
    useEffect(() => {
        const handleKeyDown = async (e: KeyboardEvent) => {
            if (e.key === 'Control') {
                ctrlPressedRef.current = true
                setIsCtrlPressed(true)
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
              helperReady: !!window.parallaxReady
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
                const ready = await webview.executeJavaScript(`!!window.parallaxReady`)
                if (!ready) {
                    console.log('[HEALTH] Parallax helper not ready, reinitializing...')
                    // Reinject the helper JS with same logic as main init
                    await webview.executeJavaScript(`
            (function() {
              if (window.parallaxReady) return;
              console.log('[WEBVIEW] Reinitializing Parallax helper...');

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
                document.querySelectorAll('.parallax-hover').forEach(el => el.classList.remove('parallax-hover'));
                return true;
              };

              document.addEventListener('keydown', (e) => {
                if (e.key === 'Escape') {
                  const backBtn = document.querySelector('[data-testid="app-bar-back"]') ||
                                  document.querySelector('[aria-label="Back"]');
                  if (backBtn) { backBtn.click(); e.preventDefault(); }
                }
              }, true);

              // Clipboard paste interception for image support
              if (!window.pendingPasteRequests) {
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

                // Handle Ctrl+V directly via keydown
                document.addEventListener('keydown', async (e) => {
                  if ((e.ctrlKey || e.metaKey) && e.key === 'v' && !window.pasteInProgress) {
                    const activeEl = document.activeElement;
                    const isInComposer = activeEl && (
                      activeEl.matches('[data-testid="tweetTextarea_0"], [data-testid="tweetTextarea_1"], [role="textbox"], [contenteditable="true"]') ||
                      activeEl.closest('[data-testid="tweetTextarea_0"], [data-testid="tweetTextarea_1"], [role="textbox"], [contenteditable="true"]')
                    );
                    if (!isInComposer) return;

                    console.log('[CLIPBOARD] Ctrl+V detected in composer');
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
                        // Convert data URL to blob without using fetch (may be blocked by CSP)
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
                        const file = new File([blob], 'pasted-image.png', { type: 'image/png' });
                        const dt = new DataTransfer();
                        dt.items.add(file);

                        // Find ALL file inputs
                        const fileInputs = document.querySelectorAll('input[type="file"][accept*="image"]');
                        fileInputs.forEach((fileInput) => {
                          try {
                            const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'files').set;
                            nativeInputValueSetter.call(fileInput, dt.files);
                            fileInput.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
                            fileInput.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
                          } catch (err) {}
                        });

                        // Try drop on all composers
                        const composers = document.querySelectorAll('[data-testid="tweetTextarea_0"], [data-testid="tweetTextarea_1"]');
                        composers.forEach((composer) => {
                          const dropTarget = composer.closest('[data-testid="toolBar"]')?.parentElement ||
                                             composer.closest('[role="dialog"]') ||
                                             composer.closest('[data-testid="primaryColumn"]') ||
                                             composer.parentElement;
                          if (dropTarget) {
                            dropTarget.dispatchEvent(new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer: dt }));
                            dropTarget.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
                            dropTarget.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
                          }
                        });
                      } catch (err) {
                        console.error('[CLIPBOARD] Error processing image:', err);
                      }
                    } else if (result && result.dataType === 'text' && result.data) {
                      document.execCommand('insertText', false, result.data);
                      e.preventDefault();
                    }
                  }
                }, true);
              }

              window.parallaxReady = true;
              console.log('[WEBVIEW] Parallax helper reinitialized!');
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
                {...{
                    allowpopups: 'true',
                    partition: 'persist:x',
                    webpreferences: 'contextIsolation=no, javascript=yes, images=yes, webSecurity=yes'
                } as any}
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
                                        <span className="text-sm font-semibold text-blue-400">Replies</span>
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
