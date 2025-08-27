import Uploader from "./uploader.js";
import Cleaner from "./cleaner.js";
import TDMSSummariser from './tdms-file-summariser.js';


class IngesterRunner{
  constructor(opts){
    this.fplus = opts.fplus;
    this.env = opts.env;
    this.eventManager = opts.eventManager;
    this.stateManager = opts.stateManager;

    this.uploader = new Uploader({
      fplus: this.fplus,
      eventManager: this.eventManager,
      stateManager: this.stateManager,
      env: opts.env,
    });

    this.cleaner = new Cleaner({
      eventManager: this.eventManager,
      stateManager: this.stateManager,
      env: opts.env,
    });

    this.tdmsSummariser = new TDMSSummariser({
      eventManager: this.eventManager,
      env: opts.env,
      driver: opts.driver,
    });

    this.retryUploadCounts = new Map();
    this.retrySummaryCounts = new Map();

    this.baseDelay = 5 * 60 * 1000;

    console.log(`Ingester Initialised.`);
  }

  async run() {
    this.registerEventHandlers();

    await this.tdmsSummariser.run();
    await this.cleaner.run();
    await this.uploader.run();
    await this.stateManager.run();


    await this.resumePendingUploads();

    console.log(`Ingester is running.`);
  }

  async resumePendingUploads() {
    const seenFiles = this.stateManager.getSeenFiles();

    for (const [filePath, meta] of seenFiles) {
      if (!meta?.isUploaded) {
        this.eventManager.emit('file:ready', { filePath });
        console.log(`Resumed pending upload for ${filePath}`);
      }
      else if(!meta.hasSummary){
        this.eventManager.emit('file:uploaded', {filePath});
        console.log(`Resumed pending summary generation for ${filePath}`);
      }
    }
  }

  registerEventHandlers() {
    this.eventManager.on('file:uuidCreated', async ({ filePath, fileUuid }) => {
      if (fileUuid) {
        await this.stateManager.updateWithUuid(filePath, fileUuid);
      } else {
        console.warn(`EVENT: Skipping UUID update for ${filePath} due to null UUID`);
      }
    });

    this.eventManager.on('file:uploaded', async ({ filePath }) => {
      await this.stateManager.updateAsUploaded(filePath);
      this.retryUploadCounts.delete(filePath);

      this.eventManager.emit('file:delete', {filePath});
    });

    this.eventManager.on('file:addedAsClassMember', async ({ filePath }) => {
      await this.stateManager.updateAsClassMember(filePath);
    });

    this.eventManager.on('file:summaryPrepared', async({filePath}) => {
      await this.stateManager.updateHasSummary(filePath);
    });

    this.eventManager.on('file:uploadFailed', ({ filePath, error }) => {
      this.retryHandleUploadFailed(filePath);
    });

    this.eventManager.on('file:summaryFailed', ({filePath, error}) => {
      this.retryHandleSummaryFailed(filePath);
    });
  }

  retryHandleUploadFailed(filePath) {
    if(!filePath){
      console.error(`NOT RETRYING as filePath is ${filePath}`);
      return;
    }
    else{
      const retries = this.retryUploadCounts.get(filePath) || 0;

      this.retryUploadCounts.set(filePath, retries + 1);

      const jitter = Math.random() * 60 * 1000; // up to 1 extra minute
      const delay = this.baseDelay + jitter;

      console.warn(`RETRYING UPLOAD: Attempt ${retries + 1} for ${filePath}, retrying in ${delay/1000}s...`);

      setTimeout(() => {
        this.eventManager.emit('file:ready', { filePath });
      }, delay);
    }
  }

  retryHandleSummaryFailed(filePath){
    if(!filePath){
      console.error(`NOT RETRYING as filePath is ${filePath}`);
      return;
    }
    else{
      const retries = this.retrySummaryCounts.get(filePath) || 0;

      this.retrySummaryCounts.set(filePath, retries + 1);

      const jitter = Math.random() * 60 * 1000; // up to 1 extra minute
      const delay = this.baseDelay + jitter;

      console.warn(`RETRYING SUMMARY GEN: Attempt ${retries + 1} for ${filePath}, retrying in ${delay/1000}s...`);

      setTimeout(() => {
        this.eventManager.emit('file:uploaded', {filePath});
      }, delay);
    }
  }
}


export default IngesterRunner;