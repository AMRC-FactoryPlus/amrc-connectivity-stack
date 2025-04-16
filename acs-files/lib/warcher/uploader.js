import { EventEmitter } from 'events';

export class Uploader extends EventEmitter{
    constructor(){
        super();
    }
    async run(){
        console.log('Uploader running');
    }
}