import { EventEmitter } from 'events';

export const EVENTS = {
  NEW_FILE: 'newFile',
  FILE_ERROR: 'fileError',
};

export class TDMSEventManager extends EventEmitter {}
