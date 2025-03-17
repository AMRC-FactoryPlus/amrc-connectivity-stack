import express from 'express';
import { APIv1 } from './api-v1.js';

export function Routes(opts) {
  const api_v1 = new APIv1(opts);

  return (app) => {
    app.use('/v1/file', api_v1.routes);
  };
}

