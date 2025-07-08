import Uploader from "./uploader.js";
import { TDMSEventManager, EVENTS } from './tdms-file-events.js';
import FolderWatcher from './folder-watcher.js';
import StateManager from './state-manager.js';
import TDMSSummariser from './tdms-file-summariser.js';


class IngesterRunner{
  constructor(opts){
    this.fplus = opts.fplus;

    this.SERVICE_USERNAME = opts.SERVICE_USERNAME;
    this.SERVICE_PASSWORD = opts.SERVICE_PASSWORD;

    this.STATE_FILE = opts.STATE_FILE;
    this.TDMS_DIR_TO_WATCH = opts.TDMS_DIR_TO_WATCH;

    this.NODE_ENV = opts.NODE_ENV;
    this.PYTHON_SUMMARISER_SCRIPT = opts.PYTHON_SUMMARISER_SCRIPT;

    this.retryUploadCounts = new Map();
    this.retrySummaryCounts = new Map();
    this.MAX_RETRIES = 5;

    this.FailureEvents = [
      EVENTS.FILE_UPLOAD_FAILED,
      EVENTS.FILE_ADD_AS_CLASS_MEMBER_FAILED,
      EVENTS.FILE_UUID_FAILED,
      EVENTS.FILE_READY_FAILED,
    ];
  }

  init(){
    this.eventManager = new TDMSEventManager();
    this.stateManager = new StateManager({ stateFile: this.STATE_FILE });

    this.uploader = new Uploader({
      fplus: this.fplus,
      username: this.SERVICE_USERNAME,
      password: this.SERVICE_PASSWORD,
      eventManager: this.eventManager,
      stateManager: this.stateManager,
    });

    this.folderWatcher = new FolderWatcher({
      folderPath: this.TDMS_DIR_TO_WATCH,
      stateManager: this.stateManager,
      eventManager: this.eventManager,
    });

    this.tdmsSummariser = new TDMSSummariser({
      eventManager: this.eventManager,
      pythonSummariserScript: this.PYTHON_SUMMARISER_SCRIPT,
    });

    console.log(`Ingester Initialised.`);
    return this;
  }

  async run() {
    this.registerEventHandlers();

    await this.tdmsSummariser.run();
    await this.uploader.run();
    await this.folderWatcher.run();
    await this.stateManager.run();

    await this.resumePendingUploads();

    console.log(`Ingester is running.`);
  }

  async resumePendingUploads() {
    const seenFiles = this.stateManager.getSeenFiles();

    for (const [filePath, meta] of seenFiles) {
      if (!meta.isUploaded) {
        this.eventManager.emit(EVENTS.FILE_READY, { filePath });
        console.log(`Resumed pending upload for ${filePath}`);
      }
      else if(!meta.hasSummary){
        this.eventManager.emit(EVENTS.FILE_UPLOADED, {filePath});
        console.log(`Resumed pending summary generation for ${filePath}`);
      }
    }
  }

  registerEventHandlers() {
    this.eventManager.on(EVENTS.FILE_DETECTED, async ({ filePath }) => {
      if (!this.stateManager.hasSeenFile(filePath)) {
        await this.stateManager.addSeenFile(filePath);
        this.eventManager.emit(EVENTS.FILE_READY, { filePath });
      }
    });

    this.eventManager.on(EVENTS.FILE_UUID_CREATED, async ({ filePath, fileUuid }) => {
      if (fileUuid) {
        await this.stateManager.updateWithUuid(filePath, fileUuid);
      } else {
        console.warn(`EVENT: Skipping UUID update for ${filePath} due to null UUID`);
      }
    });

    this.eventManager.on(EVENTS.FILE_UPLOADED, async ({ filePath }) => {
      await this.stateManager.updateAsUploaded(filePath);
      this.retryUploadCounts.delete(filePath);
    });

    this.eventManager.on(EVENTS.FILE_ADDED_AS_CLASS_MEMBER, async ({ filePath }) => {
      await this.stateManager.updateAsClassMember(filePath);
    });

    // Unified retry handler for Upload failure events
    this.FailureEvents.forEach(failureEvent => {
      this.eventManager.on(failureEvent, ({ filePath, error }) => {
        this.retryHandleFileReady(filePath);
      });
    });


    this.eventManager.on(EVENTS.FILE_SUMMARY_PREPARED, async({filePath}) => {
      await this.stateManager.updateHasSummary(filePath);
    });

    this.eventManager.on(EVENTS.FILE_SUMMARY_FAILED, ({filePath, error}) => {
      this.retryHandleFileUploaded(filePath);
    });
  }

  retryHandleFileReady(filePath) {
    const retries = this.retryUploadCounts.get(filePath) || 0;

    if (retries >= this.MAX_RETRIES) {
      console.error(`RETRYING UPLOAD: Max upload retries reached for ${filePath}. Giving up.`);
      return;
    }

    this.retryUploadCounts.set(filePath, retries + 1);
    console.warn(`RETRYING UPLOAD: Attempt ${retries + 1} for ${filePath}, retrying in 5 seconds...`);

    setTimeout(() => {
      this.eventManager.emit(EVENTS.FILE_READY, { filePath });
    }, 5000);
  }

  retryHandleFileUploaded(filePath){
    const retries = this.retrySummaryCounts.get(filePath) || 0;
    if( retries >= this.MAX_RETRIES){
      console.error(`RETRYING SUMMARY GEN: Max summary generation retries reached for ${filePath}. Giving up.`)
      return;
    }

    this.retrySummaryCounts.set(filePath, retries + 1);
    console.warn(`RETRYING SUMMARY GEN: Attempt ${retries + 1} for ${filePath}, retrying in 6 seconds...`);

    setTimeout(() => {
      this.eventManager.emit(EVENTS.FILE_UPLOADED, {filePath});
    }, 6000);
  }
}


export default IngesterRunner;