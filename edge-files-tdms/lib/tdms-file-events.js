import { EventEmitter } from 'events';

export const EVENTS = {
  NEW_FILE: 'newFile',
  NEW_FILE_ERROR: 'newFileError',
  UPLOAD_SUCCESS: 'fileUploadSuccess',
  UPLOAD_FAILED: 'fileUploadFailed',
};

export class TDMSEventManager extends EventEmitter {}
