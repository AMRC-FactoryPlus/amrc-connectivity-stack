import { ServiceClient } from '@amrc-factoryplus/service-client';
import Uploader from "../lib/uploader.js";
import { TDMSEventManager, EVENTS } from '../lib/tdms-file-events.js';
import FolderWatcher from '../lib/folder-watcher.js';
import StateManager from '../lib/state-manager.js';
import TDMSSimulator from '../tests/simulator-generator-tdms.js';

const {
  SERVICE_USERNAME,
  SERVICE_PASSWORD,
  FILES_SERVICE,
  STATE_FILE,
  TDMS_DIR_TO_WATCH,
  TDMS_SRC_DIR,
  NODE_ENV
} = process.env;

async function main() {
  const fplus = await new ServiceClient({
    env: process.env,
  }).init();

  const eventManager = new TDMSEventManager();
  const stateManager = new StateManager({stateFile:STATE_FILE, eventManager});

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

  await stateManager.run();
  await uploader.run();
  await folderWatcher.run();

  await resumePendingUploads(stateManager, eventManager);


  if (NODE_ENV !== 'production') {
    const simulator = new TDMSSimulator(TDMS_SRC_DIR, TDMS_DIR_TO_WATCH);
    await simulator.run();
  }
}

async function resumePendingUploads(stateManager, eventManager) {
    const seenFiles = stateManager.getSeenFiles();

    for (const [filePath, meta] of seenFiles) {
        if (meta.uuid && !meta.isUploaded) {
            eventManager.emit(EVENTS.FILE_DETECTED, {filePath});
        }
    }
}


function registerEventHandlers(stateManager, eventManager) {
  eventManager.on(EVENTS.FILE_DETECTED, async ({filePath}) => {
    if (!stateManager.hasSeenFile(filePath)) {
      await stateManager.addSeenFile(filePath);
      eventManager.emit(EVENTS.FILE_READY, {filePath});
    }
  });

  eventManager.on(EVENTS.FILE_UUID_CREATED, ({ filePath, fileUuid }) =>
    stateManager.updateWithUuid(filePath, fileUuid)
  );

  eventManager.on(EVENTS.FILE_UPLOADED, ({filePath}) =>
    stateManager.updateAsUploaded(filePath)
  );

  eventManager.on(EVENTS.FILE_UPLOAD_FAILED, ({ filePath, error }) => {
    console.warn(`RETRYING: Upload failed for ${filePath}, retrying in 5 seconds...`);
    setTimeout(() => {
        eventManager.emit(EVENTS.FILE_READY, {filePath});
      }, 5000);
  });
}

main().catch(err => {
  console.error("Fatal error in main:", err);
  process.exit(1);
});