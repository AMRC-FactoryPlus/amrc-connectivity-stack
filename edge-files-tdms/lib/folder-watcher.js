import chokidar from 'chokidar'
import {EVENTS} from './tdms-file-events.js';
import { normalizePath } from './utils.js';

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
      ignored: (path) => path.endsWith('.tmp')
    });

    watcher.on('ready', () => {
      console.log('WATCHER: Initial scan complete. Ready for changes.');
    });

    watcher.on('add', async (filePath) => {
      try{
        console.log(`WATCHER: File ready - ${filePath}`);
        await this.handleFile(filePath);
      }catch(err){
        console.error(`WATCHER: Unexpected error handling ${filePath}`, err);
      }
    });

    watcher.on('addDir', (dirPath) => {
      try{
        console.log(`WATCHER: Watching directory - ${dirPath}`);
      }catch(err){
        console.error(`WATCHER: Unexpected error handling ${dirPath}`, err);
      }
    });
  }

  async handleFile(filePath) {
    const normalizedPath = normalizePath(filePath);

    if (!normalizedPath || typeof normalizedPath !== 'string') {
      console.warn(`WATCHER: Invalid file path received: ${filePath}`);
      return;
    }

    try {
      this.retryCounts.delete(normalizedPath);
      this.eventManager.emit(EVENTS.FILE_DETECTED, { filePath: normalizedPath });
    } catch (err) {
      console.warn(`WATCHER: File not ready - ${normalizedPath}: ${err.message}`);

      const retries = this.retryCounts.get(normalizedPath) || 0;

      if (retries < MAX_RETRIES) {
        this.retryCounts.set(normalizedPath, retries + 1);
        console.log(`WATCHER: Retrying (${retries + 1}/${MAX_RETRIES}) - ${normalizedPath}`);
        setTimeout(() =>
          this.handleFile(normalizedPath).catch(err =>
            console.warn(`WATCHER: Retry failed for ${normalizedPath}: ${err.message}`)
          ),
          2000
        );
      } else {
        this.retryCounts.delete(normalizedPath);
        this.eventManager.emit(EVENTS.FILE_DETECTION_FAILED, { filePath: normalizedPath, error: err });
      }
    }
  }

}

export default FolderWatcher;