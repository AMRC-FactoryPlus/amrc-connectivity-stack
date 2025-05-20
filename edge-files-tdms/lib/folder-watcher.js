import chokidar from 'chokidar'
import {EVENTS} from './tdms-file-events.js';

const MAX_RETRIES = 3;

class FolderWatcher {
  constructor(opts) {
    this.folderPath = opts.folderPath;
    this.stateManager = opts.stateManager;
    this.eventManager = opts.eventManager;
    this.retryCounts = new Map();
    this.seenFiles = new Set();
  }

  async run() {
    await this.stateManager.loadSeenFiles();
    this.seenFiles = new Set(this.stateManager.getHandledFilePaths());

    const watcher = chokidar.watch(this.folderPath, {
      persistent: true,
      ignoreInitial: false,
      awaitWriteFinish: {
        stabilityThreshold: 2000,
        pollInterval: 100
      },
    });

    watcher.on('add', async (filePath) => {
      if (this.seenFiles?.has(filePath)) {
        return;
      }
      console.log(`WATCHER: File ready - ${filePath}`);
      this.handleFile(filePath);
    });

    watcher.on('addDir', (dirPath) => {
      console.log(`WATCHER: Now watching directory - ${dirPath}`);
    });
  }

  async handleFile(filePath) {
    try {
      if (!this.stateManager.hasSeenFile(filePath)) {
        await this.stateManager.addSeenFile(filePath);
        this.eventManager.emit(EVENTS.NEW_FILE, filePath);
      }
    } catch (err) {
      console.warn(`WATCHER: File not ready - ${filePath}: ${err.message}`);

      const retries = this.retryCounts.get(filePath) || 0;
      if (retries < MAX_RETRIES) {
        this.retryCounts.set(filePath, retries + 1);
        console.log(
          `WATCHER: Retrying (${retries + 1}/${MAX_RETRIES}) - ${filePath}`
        );
        setTimeout(() => this.handleFile(filePath), 2000);
      } else {
        this.retryCounts.delete(filePath);
        this.eventManager.emit(EVENTS.NEW_FILE_ERROR, { filePath, error: err });
      }
    }
  }
}

export default FolderWatcher;