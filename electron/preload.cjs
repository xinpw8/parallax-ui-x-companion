const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  analyzeTweet: (tweetText, apiEndpoint) =>
    ipcRenderer.invoke('analyze-tweet', tweetText, apiEndpoint),

  // Clipboard APIs
  clipboardHasImage: () => ipcRenderer.invoke('clipboard-has-image'),
  clipboardReadImage: () => ipcRenderer.invoke('clipboard-read-image'),
  clipboardReadText: () => ipcRenderer.invoke('clipboard-read-text'),
  clipboardWriteImage: (dataUrl) => ipcRenderer.invoke('clipboard-write-image', dataUrl),
  clipboardWriteText: (text) => ipcRenderer.invoke('clipboard-write-text', text),

  // Logging
  logToMain: (message) => console.log('[PRELOAD]', message),

  // Paste trigger from menu
  onTriggerPaste: (callback) => ipcRenderer.on('trigger-paste', callback)
})
