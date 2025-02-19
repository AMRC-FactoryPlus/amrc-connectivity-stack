import {Express, NextFunction, Request, Response} from "express";

export class FplusHttpAuth {
    constructor(config: AuthConfig);

    realm: string;
    hostname: string;
    keytab: string;
    session_length?: number;
    tokens: Map<string, any>;

    setup(app: Express.Application): void;

    auth(req: Request, res: Response, next: NextFunction): Promise<void>;

    authBasic(creds: string): Promise<any>;

    auth_gssapi(creds: string, res: Response): Promise<any>;

    auth_bearer(creds: string): Promise<string | any>;

    token(req: Request, res: Response): TokenResponse;
}

/**
 * Implements a complete Web API backend.
 * Constructs an express application internally, and configures it appropriately.
 */
export class WebAPI {
    constructor(config: WebAPIConfig);

    /**
     * Setting for cache control header
     */
    max_age: number;

    /**
     * Response to /ping
     */
    ping_response: any;

    /**
     * Http port to bind to
     */
    port: number;

    /**
     * Function to set up port
     */
    routes: (app: Express) => void;

    /**
     * FplusHttpAuth object to handle authentication
     */
    auth: FplusHttpAuth;

    /**
     * This performs the following actions:
     *
     * - The express app will be configured to parse JSON request bodies where these have an appropriate content type.
     * -CORS requests will be accepted, including requests with credentials, allowing the service to be used from a browser application.
     * - If VERBOSE is set in the environment all requests will be logged.
     * - Authentication will be configured as above.
     * - A /ping endpoint will be created, returning the value given.
     * - If max_age is passed, then all responses will include a Cache-Control header with max-age and must-revalidate (to allow caching authenticated responses).
     * - The routes function will be called, with the express app as parameter, to set up user routes.
     * @returns WebAPI Object
     */
    init(): Promise<WebAPI>;

    /**
     * Start API listening.
     */
    run(): void;

    /**
     * Express request handler for the /ping endpoint.
     * @param req Express request Object
     * @param res Express response Object
     */
    ping(req: Request, res: Response): void;
}

interface TokenResponse extends Response {
    json: Send<this>;
}

type Send<T = Response> = (body?: {
    token: string;
    expiry: number
}) => T;

export interface WebAPIConfig extends AuthConfig {
    max_age?: number;
    ping: boolean;
    http_port?: number;
    routes: (app: Express) => void;
}

export interface AuthConfig {
    realm: string;
    hostname: string;
    keytab: string;
    session_length?: number;
}