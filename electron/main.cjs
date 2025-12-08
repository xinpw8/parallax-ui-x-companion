const { app, BrowserWindow, ipcMain } = require('electron')
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

app.whenReady().then(createWindow)

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
