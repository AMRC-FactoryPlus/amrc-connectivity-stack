import $Refs from "./refs.js";
import _parse from "./parse.js";
import normalizeArgs from "./normalize-args.js";
import resolveExternal from "./resolve-external.js";
import _bundle from "./bundle.js";
import _dereference from "./dereference.js";
import * as url from "./util/url.js";
import { JSONParserError, InvalidPointerError, MissingPointerError, ResolverError, ParserError, UnmatchedParserError, UnmatchedResolverError, isHandledError, JSONParserErrorGroup, } from "./util/errors.js";
import { ono } from "@jsdevtools/ono";
import maybe from "./util/maybe.js";
import { getJsonSchemaRefParserDefaultOptions } from "./options.js";
/**
 * This class parses a JSON schema, builds a map of its JSON references and their resolved values,
 * and provides methods for traversing, manipulating, and dereferencing those references.
 *
 * @class
 */
export class $RefParser {
    constructor() {
        /**
         * The parsed (and possibly dereferenced) JSON schema object
         *
         * @type {object}
         * @readonly
         */
        this.schema = null;
        /**
         * The resolved JSON references
         *
         * @type {$Refs}
         * @readonly
         */
        this.$refs = new $Refs();
    }
    async parse() {
        const args = normalizeArgs(arguments);
        let promise;
        if (!args.path && !args.schema) {
            const err = ono(`Expected a file path, URL, or object. Got ${args.path || args.schema}`);
            return maybe(args.callback, Promise.reject(err));
        }
        // Reset everything
        this.schema = null;
        this.$refs = new $Refs();
        // If the path is a filesystem path, then convert it to a URL.
        // NOTE: According to the JSON Reference spec, these should already be URLs,
        // but, in practice, many people use local filesystem paths instead.
        // So we're being generous here and doing the conversion automatically.
        // This is not intended to be a 100% bulletproof solution.
        // If it doesn't work for your use-case, then use a URL instead.
        let pathType = "http";
        if (url.isFileSystemPath(args.path)) {
            args.path = url.fromFileSystemPath(args.path);
            pathType = "file";
        }
        else if (!args.path && args.schema && "$id" in args.schema && args.schema.$id) {
            // when schema id has defined an URL should use that hostname to request the references,
            // instead of using the current page URL
            const params = url.parse(args.schema.$id);
            const port = params.protocol === "https:" ? 443 : 80;
            args.path = `${params.protocol}//${params.hostname}:${port}`;
        }
        // Resolve the absolute path of the schema
        args.path = url.resolve(url.cwd(), args.path);
        if (args.schema && typeof args.schema === "object") {
            // A schema object was passed-in.
            // So immediately add a new $Ref with the schema object as its value
            const $ref = this.$refs._add(args.path);
            $ref.value = args.schema;
            $ref.pathType = pathType;
            promise = Promise.resolve(args.schema);
        }
        else {
            // Parse the schema file/url
            promise = _parse(args.path, this.$refs, args.options);
        }
        try {
            const result = await promise;
            if (result !== null && typeof result === "object" && !Buffer.isBuffer(result)) {
                this.schema = result;
                return maybe(args.callback, Promise.resolve(this.schema));
            }
            else if (args.options.continueOnError) {
                this.schema = null; // it's already set to null at line 79, but let's set it again for the sake of readability
                return maybe(args.callback, Promise.resolve(this.schema));
            }
            else {
                throw ono.syntax(`"${this.$refs._root$Ref.path || result}" is not a valid JSON Schema`);
            }
        }
        catch (err) {
            if (!args.options.continueOnError || !isHandledError(err)) {
                return maybe(args.callback, Promise.reject(err));
            }
            if (this.$refs._$refs[url.stripHash(args.path)]) {
                this.$refs._$refs[url.stripHash(args.path)].addError(err);
            }
            return maybe(args.callback, Promise.resolve(null));
        }
    }
    static parse() {
        const parser = new $RefParser();
        return parser.parse.apply(parser, arguments);
    }
    async resolve() {
        const args = normalizeArgs(arguments);
        try {
            await this.parse(args.path, args.schema, args.options);
            await resolveExternal(this, args.options);
            finalize(this);
            return maybe(args.callback, Promise.resolve(this.$refs));
        }
        catch (err) {
            return maybe(args.callback, Promise.reject(err));
        }
    }
    static resolve() {
        const instance = new $RefParser();
        return instance.resolve.apply(instance, arguments);
    }
    static bundle() {
        const instance = new $RefParser();
        return instance.bundle.apply(instance, arguments);
    }
    async bundle() {
        const args = normalizeArgs(arguments);
        try {
            await this.resolve(args.path, args.schema, args.options);
            _bundle(this, args.options);
            finalize(this);
            return maybe(args.callback, Promise.resolve(this.schema));
        }
        catch (err) {
            return maybe(args.callback, Promise.reject(err));
        }
    }
    static dereference() {
        const instance = new $RefParser();
        return instance.dereference.apply(instance, arguments);
    }
    async dereference() {
        const args = normalizeArgs(arguments);
        try {
            await this.resolve(args.path, args.schema, args.options);
            _dereference(this, args.options);
            finalize(this);
            return maybe(args.callback, Promise.resolve(this.schema));
        }
        catch (err) {
            return maybe(args.callback, Promise.reject(err));
        }
    }
}
export default $RefParser;
function finalize(parser) {
    const errors = JSONParserErrorGroup.getParserErrors(parser);
    if (errors.length > 0) {
        throw new JSONParserErrorGroup(parser);
    }
}
export const parse = $RefParser.parse;
export const resolve = $RefParser.resolve;
export const bundle = $RefParser.bundle;
export const dereference = $RefParser.dereference;
export { UnmatchedResolverError, JSONParserError, InvalidPointerError, MissingPointerError, ResolverError, ParserError, UnmatchedParserError, isHandledError, JSONParserErrorGroup, _dereference as dereferenceInternal, normalizeArgs as jsonSchemaParserNormalizeArgs, getJsonSchemaRefParserDefaultOptions, };
