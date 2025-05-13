import fs from 'fs/promises';
import path from 'path';

const CHUNK_SIZE = 1024 * 1024;
const WRITE_INTERVAL_MS = 100;

function sleep(ms){
    return new Promise(resolve => setTimeout(resolve, ms));
}

class TDMSSimulator{
    constructor(srcDir, destDir){
        this.srcDir = srcDir;
        this.destDir = destDir;
    }

    async writeTDMS(srcFilePath, destFilePath){
        const srcHandle = await fs.open(srcFilePath, 'r');
        const destHandle = await fs.open(destFilePath, 'w');

        try{
            const stats = await srcHandle.stat();
            const totalSize = stats.size;
            let offset = 0;

            while(offset < totalSize){
                const remaining = totalSize - offset;
                const size = Math.min(CHUNK_SIZE, remaining);
                const buffer = Buffer.alloc(size);

                await srcHandle.read(buffer, 0, size, offset);
                await destHandle.write(buffer, 0, size, offset);

                offset += size;

                await sleep(WRITE_INTERVAL_MS);
            }

            console.log(`SIMULATOR: Finished writing ${path.basename(this.destDir)}`);

        }
        finally{
            await srcHandle.close();
            await destHandle.close();
        }
    }

    async run(){
        const files = await fs.readdir(this.srcDir);
        const tdmsFiles = files.filter(f => f.endsWith('.tdms'));

        if(tdmsFiles.length === 0){
            console.error(`SIMULATOR: No .tdms files found in the src folder.`);
            return;
        }

        for (const file of tdmsFiles){
            console.log(`SIMULATOR: Generating ${file}...`);
            const srcPath = path.join(this.srcDir, file);
            const destPath = path.join(this.destDir, file);
            await this.writeTDMS(srcPath, destPath);
        }
        console.log(`SIMULATOR: All files written.`);
    }
}

export default TDMSSimulator;