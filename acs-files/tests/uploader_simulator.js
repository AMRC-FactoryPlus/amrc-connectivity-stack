import fs from 'fs/promises';
import path from 'path';
import { sleep } from '../lib/utils/time_utils.js';

export class Simulator{
    constructor(folderPath){
        this.folderPath = folderPath;
    }

    async start(){
        await this.generateFiles();
    }



    async generateFiles(){
        for (let i = 0; i <= 10; i++){
            const filePath = path.join(this.folderPath, `${i.toString()}`);
            await fs.writeFile(filePath, `Content is ${i}`);
            console.log(`SIMULATOR: Written file ${i}.txt`);
            await sleep(0.001);
        }
    }

}