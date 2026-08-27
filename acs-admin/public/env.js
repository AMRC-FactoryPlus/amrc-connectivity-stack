/* Deployment environment, substituted at container start.
 *
 * This lives in its own file rather than inline in index.html so the console
 * can run under a Content-Security-Policy with no 'unsafe-inline'. The
 * placeholder below is rewritten by import-meta-env when the container
 * starts, which means its content differs per deployment and no build-time
 * hash could ever cover it. As a separate same-origin file it needs neither
 * a hash nor an exemption.
 *
 * Loaded as a classic script in <head>, so it runs before the deferred
 * application module and globalThis.import_meta_env is set by the time
 * anything reads it.
 *
 * See acs-admin/.docker/nginx.conf and the CMD in the Dockerfile.
 */
globalThis.import_meta_env = JSON.parse('"import_meta_env_placeholder"')
