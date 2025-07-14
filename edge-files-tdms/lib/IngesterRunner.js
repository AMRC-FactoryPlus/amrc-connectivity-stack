import Uploader from "./uploader.js";
import StateManager from './state-manager.js';
// import TDMSSummariser from './tdms-file-summariser.js';


class IngesterRunner{
  constructor(opts){
    this.fplus = opts.fplus;
    this.env = opts.env;
    this.eventManager = opts.eventManager;

    this.stateManager = new StateManager({ env: this.env });

    this.uploader = new Uploader({
      fplus: this.fplus,
      eventManager: this.eventManager,
      stateManager: this.stateManager,
    });

    // this.tdmsSummariser = new TDMSSummariser({
    //   eventManager: this.eventManager,
    //   env: this.env,
    // });

    this.retryUploadCounts = new Map();
    this.retrySummaryCounts = new Map();

    this.FailureEvents = [
      'file:uploadFailed',
      'file:addAsClassMemberFailed',
      'file:uuidFailed',
      'file:readyFailed',
    ];

    this.baseDelay = 5 * 60 * 1000;

    console.log(`Ingester Initialised.`);

  }


  async run() {
    this.registerEventHandlers();

    // await this.tdmsSummariser.run();
    await this.uploader.run();
    await this.stateManager.run();

    await this.resumePendingUploads();

    console.log(`Ingester is running.`);
  }

  async resumePendingUploads() {
    const seenFiles = this.stateManager.getSeenFiles();

    for (const [filePath, meta] of seenFiles) {
      if (!meta.isUploaded) {
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
    this.eventManager.on('file:detected', async ({ filePath }) => {
      if (!this.stateManager.hasSeenFile(filePath)) {
        try{
          await this.stateManager.addSeenFile(filePath);
          this.eventManager.emit('file:ready', { filePath });
        }catch(err){
          console.error(`Failed to persist state for file ${filePath}:`, err);
        }
      }
    });

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
    });

    this.eventManager.on('file:addedAsClassMember', async ({ filePath }) => {
      await this.stateManager.updateAsClassMember(filePath);
    });

    // Unified retry handler for Upload failure events
    this.FailureEvents.forEach(failureEvent => {
      this.eventManager.on(failureEvent, ({ filePath, error }) => {
        this.retryHandleFileReady(filePath);
      });
    });


    this.eventManager.on('file:summaryPrepared', async({filePath}) => {
      await this.stateManager.updateHasSummary(filePath);
    });

    this.eventManager.on('file:summaryFailed', ({filePath, error}) => {
      this.retryHandleFileUploaded(filePath);
    });
  }

  retryHandleFileReady(filePath) {
    const retries = this.retryUploadCounts.get(filePath) || 0;

    this.retryUploadCounts.set(filePath, retries + 1);

    const jitter = Math.random() * 60 * 1000; // up to 1 extra minute
    const delay = this.baseDelay + jitter;

    console.warn(`RETRYING UPLOAD: Attempt ${retries + 1} for ${filePath}, retrying in ${delay/1000}s...`);

    setTimeout(() => {
      this.eventManager.emit('file:ready', { filePath });
    }, delay);
  }

  retryHandleFileUploaded(filePath){
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


export default IngesterRunner;