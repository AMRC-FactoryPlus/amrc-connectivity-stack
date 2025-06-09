import { ServiceClient } from '@amrc-factoryplus/service-client';
import Uploader from "../lib/uploader.js";
import { TDMSEventManager, EVENTS } from '../lib/tdms-file-events.js';
import FolderWatcher from '../lib/folder-watcher.js';
import StateManager from '../lib/state-manager.js';
import TDMSSimulator from '../tests/simulator-generator-tdms.js';
const retryCounts = new Map();
const MAX_RETRIES = 5;

const {
  SERVICE_USERNAME,
  SERVICE_PASSWORD,
  FILES_SERVICE,
  STATE_FILE,
  TDMS_DIR_TO_WATCH,
  TDMS_SRC_DIR,
  NODE_ENV
} = process.env;

const FailureEvents = [
    EVENTS.FILE_UPLOAD_FAILED,
    EVENTS.FILE_ADD_AS_CLASS_MEMBER_FAILED,
    EVENTS.FILE_UUID_FAILED,
    EVENTS.FILE_READY_FAILED,
  ];

async function main() {
  const fplus = await new ServiceClient({ env: process.env }).init();

  const eventManager = new TDMSEventManager();
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

  registerEventHandlers(stateManager, eventManager);

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
    retryCounts.delete(filePath);
  });

  eventManager.on(EVENTS.FILE_ADDED_AS_CLASS_MEMBER, async ({ filePath }) => {
    await stateManager.updateAsClassMember(filePath);
  });

  // Unified retry handler for all failure events
  FailureEvents.forEach(failureEvent => {
    eventManager.on(failureEvent, ({ filePath, error }) => {
      retryHandleFileReady(eventManager, filePath);
    });
  });
}


function retryHandleFileReady(eventManager, filePath) {
  const retries = retryCounts.get(filePath) || 0;

  if (retries >= MAX_RETRIES) {
    console.error(`RETRYING: Max retries reached for ${filePath}. Giving up.`);
    return;
  }

  retryCounts.set(filePath, retries + 1);
  console.warn(`RETRYING: Attempt ${retries + 1} for ${filePath}, retrying in 5 seconds...`);

  setTimeout(() => {
    eventManager.emit(EVENTS.FILE_READY, { filePath });
  }, 5000);
}

main().catch(err => {
  console.error("Fatal error in main:", err);
  process.exit(1);
});
