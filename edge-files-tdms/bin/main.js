import { ServiceClient } from '@amrc-factoryplus/service-client';
import Uploader from "../lib/uploader.js";
import { TDMSEventManager, EVENTS } from '../lib/tdms-file-events.js';
import FolderWatcher from '../lib/folder-watcher.js';
import StateManager from '../lib/state-manager.js';
import TDMSSummariser from '../lib/tdms-file-summariser.js';
// import TDMSSimulator from '../tests/simulator-generator-tdms.js';

const retryUploadCounts = new Map();
const retrySummaryCounts = new Map();

const MAX_RETRIES = 5;

const {
  SERVICE_USERNAME,
  SERVICE_PASSWORD,
  FILES_SERVICE,
  STATE_FILE,
  TDMS_DIR_TO_WATCH,
  //TDMS_SRC_DIR,
  //NODE_ENV,
  PYTHON_SUMMARISER_SCRIPT,
} = process.env;

const FailureEvents = [
    EVENTS.FILE_UPLOAD_FAILED,
    EVENTS.FILE_ADD_AS_CLASS_MEMBER_FAILED,
    EVENTS.FILE_UUID_FAILED,
    EVENTS.FILE_READY_FAILED,
  ];

async function main(driver,conf) {

  console.log("Initializing TDMS Edge Driver...");
  // console.log("Configuration:", conf);    
  // console.log("Driver:", driver);

  const fplus = await new ServiceClient({ env: process.env }).init();

  const eventManager = new TDMSEventManager();
  console.log("Statemanager initialized with state file:", SERVICE_USERNAME, SERVICE_PASSWORD, FILES_SERVICE, STATE_FILE, TDMS_DIR_TO_WATCH, PYTHON_SUMMARISER_SCRIPT);
  const stateManager = new StateManager({ stateFile: STATE_FILE });

  const uploader = new Uploader({
    fplus,
    username: SERVICE_USERNAME,
    password: SERVICE_PASSWORD,
    filesServiceUrl: FILES_SERVICE,
    eventManager,
    stateManager,
  });

  const folderWatcher = new FolderWatcher({
    folderPath: TDMS_DIR_TO_WATCH,
    stateManager,
    eventManager,
  });

  const tdmsSummariser = new TDMSSummariser({
    eventManager,
    pythonSummariserScript: PYTHON_SUMMARISER_SCRIPT,
    driver: driver,
  });

  registerEventHandlers(stateManager, eventManager);

  await tdmsSummariser.run();
  await uploader.run();
  await folderWatcher.run();
  await stateManager.run();

  await resumePendingUploads(stateManager, eventManager);

  // if (NODE_ENV !== 'production') {
  //   const simulator = new TDMSSimulator(TDMS_SRC_DIR, TDMS_DIR_TO_WATCH);
  //   await simulator.run();
  // }
}

async function resumePendingUploads(stateManager, eventManager) {
  const seenFiles = await stateManager.getSeenFiles();

  for (const [filePath, meta] of seenFiles) {
    if (!meta.isUploaded) {
      eventManager.emit(EVENTS.FILE_READY, { filePath });
      console.log(`Resumed pending upload for ${filePath}`);
    }
    else if(!meta.hasSummary){
      eventManager.emit(EVENTS.FILE_UPLOADED, {filePath});
      console.log(`Resumed pending summary generation for ${filePath}`);
    }
  }
}


function registerEventHandlers(stateManager, eventManager) {
  eventManager.on(EVENTS.FILE_DETECTED, async ({ filePath }) => {
    if (!stateManager.hasSeenFile(filePath)) {
      await stateManager.addSeenFile(filePath);
      eventManager.emit(EVENTS.FILE_READY, { filePath });
    }
  });

  eventManager.on(EVENTS.FILE_UUID_CREATED, async ({ filePath, fileUuid }) => {
    if (fileUuid) {
      await stateManager.updateWithUuid(filePath, fileUuid);
    } else {
      console.warn(`EVENT: Skipping UUID update for ${filePath} due to null UUID`);
    }
  });

  eventManager.on(EVENTS.FILE_UPLOADED, async ({ filePath }) => {
    await stateManager.updateAsUploaded(filePath);
    retryUploadCounts.delete(filePath);
  });

  eventManager.on(EVENTS.FILE_ADDED_AS_CLASS_MEMBER, async ({ filePath }) => {
    await stateManager.updateAsClassMember(filePath);
  });

  // Unified retry handler for Upload failure events
  FailureEvents.forEach(failureEvent => {
    eventManager.on(failureEvent, ({ filePath, error }) => {
      retryHandleFileReady(eventManager, filePath);
    });
  });


  eventManager.on(EVENTS.FILE_SUMMARY_PREPARED, async({filePath}) => {
    await stateManager.updateHasSummary(filePath);
  });

  eventManager.on(EVENTS.FILE_SUMMARY_FAILED, ({filePath, error}) => {
    retryHandleFileUploaded(eventManager, filePath);
  });
}

function retryHandleFileReady(eventManager, filePath) {
  const retries = retryUploadCounts.get(filePath) || 0;

  if (retries >= MAX_RETRIES) {
    console.error(`RETRYING UPLOAD: Max upload retries reached for ${filePath}. Giving up.`);
    return;
  }

  retryUploadCounts.set(filePath, retries + 1);
  console.warn(`RETRYING UPLOAD: Attempt ${retries + 1} for ${filePath}, retrying in 5 seconds...`);

  setTimeout(() => {
    eventManager.emit(EVENTS.FILE_READY, { filePath });
  }, 5000);
}

function retryHandleFileUploaded(eventManager, filePath){
  const retries = retrySummaryCounts.get(filePath) || 0;
  if( retries >= MAX_RETRIES){
    console.error(`RETRYING SUMMARY GEN: Max summary generation retries reached for ${filePath}. Giving up.`)
    return;
  }

  retrySummaryCounts.set(filePath, retries + 1);
  console.warn(`RETRYING SUMMARY GEN: Attempt ${retries + 1} for ${filePath}, retrying in 6 seconds...`);

  setTimeout(() => {
    eventManager.emit(EVENTS.FILE_UPLOADED, {filePath});
  }, 6000);
}

main().catch(err => {
  console.error("Fatal error in main:", err);
  process.exit(1);
});

export default main;