import FolderWatcher from '../lib/folder-watcher.js';
import TDMSSimulator from '../tests/simulator-generator-tdms.js';
import Uploader from '../lib/uploader.js';
import StateManager from '../lib/stateManager.js';

const {env} = process;

async function main(){
    const stateManager = new StateManager(env.STATE_FILE);

    const simulator = new TDMSSimulator(env.TDMS_SOURCE_DIR, env.TDMS_DESTINATION_DIR);
    const watcher = new FolderWatcher(env.TDMS_DESTINATION_DIR, stateManager);
    // const uploader = new Uploader('', watcher, stateManager);

    await watcher.run();
    // await uploader.run();
    await simulator.run();

}

await main();