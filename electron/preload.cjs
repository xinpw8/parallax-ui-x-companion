const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  analyzeTweet: (tweetText, apiEndpoint) =>
    ipcRenderer.invoke('analyze-tweet', tweetText, apiEndpoint)
})
