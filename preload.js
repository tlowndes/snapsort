'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// The only way the window talks to the main process.
const call = (channel) => (...args) => ipcRenderer.invoke(channel, ...args);
const on = (channel) => (callback) => ipcRenderer.on(channel, (_e, payload) => callback(payload));

contextBridge.exposeInMainWorld('snapsort', {
  getState: call('get-state'),
  thumb: call('thumb'),
  folderFiles: call('folder-files'),
  file: call('file'),
  fileAll: call('file-all'),
  leave: call('leave'),
  undo: call('undo'),
  reread: call('reread'),
  sortExisting: call('sort-existing'),
  setPaused: call('set-paused'),
  showInFolder: call('show-in-folder'),
  openFile: call('open-file'),
  openFolder: call('open-folder'),
  pickFolder: call('pick-folder'),
  saveSettings: call('save-settings'),
  testKey: call('test-key'),
  checkUpdates: call('check-updates'),
  installUpdate: call('install-update'),
  onStateChanged: on('state-changed'),
  onFiled: on('filed'),
  onProgress: on('progress'),
  onShowPage: on('show-page'),
});
