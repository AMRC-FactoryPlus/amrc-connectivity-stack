import { Ono } from "@jsdevtools/ono";
import { getHash, stripHash, toFileSystemPath } from "./url.js";
export class JSONParserError extends Error {
    constructor(message, source) {
        super();
        this.code = "EUNKNOWN";
        this.name = "JSONParserError";
        this.message = message;
        this.source = source;
        this.path = null;
        Ono.extend(this);
    }
    get footprint() {
        return `${this.path}+${this.source}+${this.code}+${this.message}`;
    }
}
export class JSONParserErrorGroup extends Error {
    constructor(parser) {
        super();
        this.files = parser;
        this.name = "JSONParserErrorGroup";
        this.message = `${this.errors.length} error${this.errors.length > 1 ? "s" : ""} occurred while reading '${toFileSystemPath(parser.$refs._root$Ref.path)}'`;
        Ono.extend(this);
    }
    static getParserErrors(parser) {
        const errors = [];
        for (const $ref of Object.values(parser.$refs._$refs)) {
            if ($ref.errors) {
                errors.push(...$ref.errors);
            }
        }
        return errors;
    }
    get errors() {
        return JSONParserErrorGroup.getParserErrors(this.files);
    }
}
export class ParserError extends JSONParserError {
    constructor(message, source) {
        super(`Error parsing ${source}: ${message}`, source);
        this.code = "EPARSER";
        this.name = "ParserError";
    }
}
export class UnmatchedParserError extends JSONParserError {
    constructor(source) {
        super(`Could not find parser for "${source}"`, source);
        this.code = "EUNMATCHEDPARSER";
        this.name = "UnmatchedParserError";
    }
}
export class ResolverError extends JSONParserError {
    constructor(ex, source) {
        super(ex.message || `Error reading file "${source}"`, source);
        this.code = "ERESOLVER";
        this.name = "ResolverError";
        if ("code" in ex) {
            this.ioErrorCode = String(ex.code);
        }
    }
}
export class UnmatchedResolverError extends JSONParserError {
    constructor(source) {
        super(`Could not find resolver for "${source}"`, source);
        this.code = "EUNMATCHEDRESOLVER";
        this.name = "UnmatchedResolverError";
    }
}
export class MissingPointerError extends JSONParserError {
    constructor(token, path, targetRef, targetFound, parentPath) {
        super(`Missing $ref pointer "${getHash(path)}". Token "${token}" does not exist.`, stripHash(path));
        this.code = "EMISSINGPOINTER";
        this.name = "MissingPointerError";
        this.targetToken = token;
        this.targetRef = targetRef;
        this.targetFound = targetFound;
        this.parentPath = parentPath;
    }
}
export class TimeoutError extends JSONParserError {
    constructor(timeout) {
        super(`Dereferencing timeout reached: ${timeout}ms`);
        this.code = "ETIMEOUT";
        this.name = "TimeoutError";
    }
}
export class InvalidPointerError extends JSONParserError {
    constructor(pointer, path) {
        super(`Invalid $ref pointer "${pointer}". Pointers must begin with "#/"`, stripHash(path));
        this.code = "EUNMATCHEDRESOLVER";
        this.name = "InvalidPointerError";
    }
}
export function isHandledError(err) {
    return err instanceof JSONParserError || err instanceof JSONParserErrorGroup;
}
export function normalizeError(err) {
    if (err.path === null) {
        err.path = [];
    }
    return err;
}
