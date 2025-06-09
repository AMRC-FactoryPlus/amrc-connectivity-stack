import { EventEmitter } from 'events';

export const EVENTS = {
  FILE_DETECTED: 'file:detected',
  FILE_DETECTION_FAILED: 'file:detectionFailed',

  FILE_READY: 'file:ready',
  FILE_READY_FAILED: 'file:readyFailed',

  FILE_UUID_CREATED: 'file:uuidCreated',
  FILE_UUID_FAILED: 'file:uuidFailed',

  FILE_UPLOADED: 'file:uploaded',
  FILE_UPLOAD_FAILED: 'file:uploadFailed',

  FILE_ADDED_AS_CLASS_MEMBER: 'file:addedAsClassMember',
  FILE_ADD_AS_CLASS_MEMBER_FAILED: 'file:addAsClassMemberFailed',

  FILE_SKIPPED: 'file:skipped',
};

export class TDMSEventManager extends EventEmitter {}
