const { app, BrowserWindow, ipcMain, clipboard, nativeImage, Menu } = require('electron')
const path = require('path')

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
  createWindow()
  createMenu()
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

