import chokidar from 'chokidar'
import {EVENTS} from './tdms-file-events.js';

const MAX_RETRIES = 3;

class FolderWatcher {
  constructor(opts) {
    this.folderPath = opts.folderPath;
    this.eventManager = opts.eventManager;
    this.retryCounts = new Map();
  }

  async run() {
    const watcher = chokidar.watch(this.folderPath, {
      persistent: true,
      ignoreInitial: false,
      awaitWriteFinish: {
        stabilityThreshold: 2000,
        pollInterval: 100
      },
    });

    watcher.on('ready', () => {
      console.log('WATCHER: Initial scan complete. Ready for changes.');
    });

    watcher.on('add', async (filePath) => {
      console.log(`WATCHER: File ready - ${filePath}`);
      await this.handleFile(filePath);
    });

    watcher.on('addDir', (dirPath) => {
      console.log(`WATCHER: Watching directory - ${dirPath}`);
    });
  }

  async handleFile(filePath) {
    try {
      this.eventManager.emit(EVENTS.FILE_DETECTED, {filePath});

    } catch (err) {
      console.warn(`WATCHER: File not ready - ${filePath}: ${err.message}`);

      const retries = this.retryCounts.get(filePath) || 0;
      if (retries < MAX_RETRIES) {
        this.retryCounts.set(filePath, retries + 1);
        console.log(
          `WATCHER: Retrying (${retries + 1}/${MAX_RETRIES}) - ${filePath}`
        );
        setTimeout(() => this.handleFile(filePath).catch(err => console.warn(`WATCHER: Retry failed for ${filePath}: ${err.message}`)), 2000);
      } else {
        this.retryCounts.delete(filePath);
        this.eventManager.emit(EVENTS.FILE_DETECTION_FAILED, { filePath, error: err });
      }
    }
  }
}

export default FolderWatcher;