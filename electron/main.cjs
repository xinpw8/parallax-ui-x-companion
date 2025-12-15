const { app, BrowserWindow, ipcMain, clipboard, nativeImage, Menu, session, webContents } = require('electron')
const path = require('path')
const fs = require('fs')

// Increase EventEmitter limit to prevent MaxListenersExceededWarning
require('events').EventEmitter.defaultMaxListeners = 50

// Debug logging setup
const DEBUG_LOG_DIR = path.join(__dirname, '..', 'debug_logs')
const DEBUG_LOG_FILE = path.join(DEBUG_LOG_DIR, `electron_main_${new Date().toISOString().replace(/[:.]/g, '-')}.log`)

// Ensure debug directory exists
try {
  if (!fs.existsSync(DEBUG_LOG_DIR)) {
    fs.mkdirSync(DEBUG_LOG_DIR, { recursive: true })
  }
} catch (e) {
  console.error('Failed to create debug_logs directory:', e)
}

function debugLog(...args) {
  const timestamp = new Date().toISOString()
  const message = `[${timestamp}] ${args.map(a => typeof a === 'object' ? JSON.stringify(a) : a).join(' ')}`
  console.log(message)
  try {
    fs.appendFileSync(DEBUG_LOG_FILE, message + '\n')
  } catch (e) {
    // Ignore write errors
  }
}

debugLog('[MAIN] Electron main process starting...')
debugLog('[MAIN] Debug log file:', DEBUG_LOG_FILE)

// GPU flags for video rendering in webviews on Windows
// app.disableHardwareAcceleration() // Didn't work
// app.commandLine.appendSwitch('disable-gpu-compositing') // Trying without this

// Enable proprietary video codecs for video/GIF playback in webviews
if (process.platform === 'win32') {
  app.commandLine.appendSwitch('enable-features', 'PlatformHEVCDecoderSupport,D3D11VideoDecoder,MediaFoundationD3D11VideoCapture')
} else if (process.platform === 'linux') {
  app.commandLine.appendSwitch('enable-features', 'PlatformHEVCDecoderSupport,VaapiVideoDecodeLinuxGL')
} else {
  app.commandLine.appendSwitch('enable-features', 'PlatformHEVCDecoderSupport')
}
app.commandLine.appendSwitch('enable-accelerated-video-decode')
app.commandLine.appendSwitch('enable-accelerated-video-encode')
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')
app.commandLine.appendSwitch('disable-features', 'HardwareMediaKeyHandling')
app.commandLine.appendSwitch('ignore-gpu-blocklist')
app.commandLine.appendSwitch('enable-gpu-rasterization')

let mainWindow

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 600,
    frame: true,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#0a0a0f',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.cjs'),
      webviewTag: true
    }
  })

  // In dev, load from Vite server; in prod, load built files
  const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged
  if (isDev) {
    mainWindow.loadURL('http://localhost:5173')
    mainWindow.webContents.openDevTools()
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }
}

app.whenReady().then(() => {
  debugLog('[MAIN] App ready')

  // Set up permissions for the webview partition to allow media playback
  const webviewSession = session.fromPartition('persist:x')
  webviewSession.setPermissionRequestHandler((webContents, permission, callback) => {
    const allowedPermissions = ['media', 'mediaKeySystem', 'geolocation', 'notifications', 'fullscreen', 'pointerLock']
    if (allowedPermissions.includes(permission)) {
      callback(true)
    } else {
      debugLog('[PERMISSION] Denied:', permission)
      callback(false)
    }
  })

  // Also handle permission checks
  webviewSession.setPermissionCheckHandler((webContents, permission) => {
    const allowedPermissions = ['media', 'mediaKeySystem', 'geolocation', 'notifications', 'fullscreen', 'pointerLock']
    return allowedPermissions.includes(permission)
  })

  createWindow()
  createMenu()

  debugLog('[MAIN] Window and menu created')
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})


// Handle API calls from renderer
ipcMain.handle('analyze-tweet', async (event, tweetText, apiEndpoint) => {
  const fetch = (await import('node-fetch')).default

  const prompt = `You are a witty reply guy on Twitter/X. Generate a short, clever reply to this tweet.

Rules:
- All lowercase
- Under 280 characters
- Be funny, insightful, or add value
- No emojis unless absolutely necessary
- Sound natural, like a real person

Tweet: "${tweetText}"

Reply with ONLY the reply text, nothing else.`

  try {
    const response = await fetch(`${apiEndpoint}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 100,
        stream: false,
        chat_template_kwargs: { enable_thinking: false }
      })
    })

    if (!response.ok) throw new Error('API failed')

    const data = await response.json()
    return data.choices?.[0]?.message?.content?.trim() || ''
  } catch (error) {
    console.error('API Error:', error)
    return null
  }
})

// Clipboard IPC handlers
ipcMain.handle('clipboard-has-image', () => {
  const image = clipboard.readImage()
  const hasImage = !image.isEmpty()
  console.log('[CLIPBOARD] hasImage:', hasImage, 'size:', image.getSize())
  return hasImage
})

ipcMain.handle('clipboard-read-image', () => {
  const image = clipboard.readImage()
  if (image.isEmpty()) {
    console.log('[CLIPBOARD] readImage: empty')
    return null
  }
  const dataUrl = image.toDataURL()
  console.log('[CLIPBOARD] readImage: got dataUrl, length:', dataUrl.length)
  return dataUrl
})

ipcMain.handle('clipboard-read-text', () => {
  return clipboard.readText()
})

ipcMain.handle('clipboard-write-image', (event, dataUrl) => {
  try {
    const image = nativeImage.createFromDataURL(dataUrl)
    clipboard.writeImage(image)
    return true
  } catch (error) {
    console.error('Error writing image to clipboard:', error)
    return false
  }
})

ipcMain.handle('clipboard-write-text', (event, text) => {
  clipboard.writeText(text)
  return true
})

// Debug log handler from renderer
ipcMain.handle('debug-log', (event, message) => {
  debugLog('[RENDERER]', message)
  return true
})

// Get debug log path
ipcMain.handle('get-debug-log-path', () => {
  return DEBUG_LOG_FILE
})

// Set up application menu with Edit menu for clipboard operations
function createMenu() {
  const template = [
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        {
          label: 'Paste',
          accelerator: 'CmdOrCtrl+V',
          click: () => {
            if (mainWindow) {
              mainWindow.webContents.send('trigger-paste')
            }
          }
        },
        { role: 'pasteAndMatchStyle' },
        { role: 'delete' },
        { type: 'separator' },
        { role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        { role: 'close' }
      ]
    }
  ]

  // Add macOS-specific menu
  if (process.platform === 'darwin') {
    template.unshift({
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    })
  }

  const menu = Menu.buildFromTemplate(template)
  Menu.setApplicationMenu(menu)
}

