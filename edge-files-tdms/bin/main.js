import { ServiceClient } from '@amrc-factoryplus/service-client';
import Uploader from "../lib/uploader.js";
import { TDMSEventManager, EVENTS } from '../lib/tdms-file-events.js';
import FolderWatcher from '../lib/folder-watcher.js';
import StateManager from '../lib/state-manager.js';
import TDMSSimulator from '../tests/simulator-generator-tdms.js';

const {
  UNAME,
  PASSWORD,
  FILES_SERVICE,
  STATE_FILE,
  TDMS_DIR_TO_WATCH,
  NODE_ENV
} = process.env;

async function main() {
  const fplus = await new ServiceClient({
    env: process.env,
  }).init();

  const eventManager = new TDMSEventManager();
  const stateManager = new StateManager(STATE_FILE);
  eventManager.on(EVENTS.UPLOAD_SUCCESS, stateManager.updateAsUploaded.bind(stateManager));

  // const uploader = new Uploader({
  //   fplus,
  //   username: UNAME,
  //   password: PASSWORD,
  //   filesServiceUrl: FILES_SERVICE,
  //   eventManager,
  // });

  const folderWatcher = new FolderWatcher({
    folderPath: TDMS_DIR_TO_WATCH,
    stateManager,
    eventManager,
  });

  await stateManager.loadSeenFiles();
  // await uploader.run();
  await folderWatcher.run();

  if (NODE_ENV !== 'production') {
    const simulator = new TDMSSimulator('./tests/tdms_files', TDMS_DIR_TO_WATCH);
    await simulator.run();
  }
}

main().catch(err => {
  console.error("Fatal error in main:", err);
  process.exit(1);
});
