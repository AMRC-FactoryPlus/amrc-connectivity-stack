import { ono } from "@jsdevtools/ono";
import $Ref from "./ref.js";
import * as url from "./util/url.js";
import convertPathToPosix from "./util/convert-path-to-posix";
/**
 * When you call the resolve method, the value that gets passed to the callback function (or Promise) is a $Refs object. This same object is accessible via the parser.$refs property of $RefParser objects.
 *
 * This object is a map of JSON References and their resolved values. It also has several convenient helper methods that make it easy for you to navigate and manipulate the JSON References.
 *
 * See https://apitools.dev/json-schema-ref-parser/docs/refs.html
 */
export default class $Refs {
    /**
     * Returns the paths/URLs of all the files in your schema (including the main schema file).
     *
     * See https://apitools.dev/json-schema-ref-parser/docs/refs.html#pathstypes
     *
     * @param types (optional) Optionally only return certain types of paths ("file", "http", etc.)
     */
    paths(...types) {
        const paths = getPaths(this._$refs, types.flat());
        return paths.map((path) => {
            return convertPathToPosix(path.decoded);
        });
    }
    /**
     * Returns a map of paths/URLs and their correspond values.
     *
     * See https://apitools.dev/json-schema-ref-parser/docs/refs.html#valuestypes
     *
     * @param types (optional) Optionally only return values from certain locations ("file", "http", etc.)
     */
    values(...types) {
        const $refs = this._$refs;
        const paths = getPaths($refs, types.flat());
        return paths.reduce((obj, path) => {
            obj[convertPathToPosix(path.decoded)] = $refs[path.encoded].value;
            return obj;
        }, {});
    }
    /**
     * Returns `true` if the given path exists in the schema; otherwise, returns `false`
     *
     * See https://apitools.dev/json-schema-ref-parser/docs/refs.html#existsref
     *
     * @param $ref The JSON Reference path, optionally with a JSON Pointer in the hash
     */
    /**
     * Determines whether the given JSON reference exists.
     *
     * @param path - The path being resolved, optionally with a JSON pointer in the hash
     * @param [options]
     * @returns
     */
    exists(path, options) {
        try {
            this._resolve(path, "", options);
            return true;
        }
        catch {
            return false;
        }
    }
    /**
     * Resolves the given JSON reference and returns the resolved value.
     *
     * @param path - The path being resolved, with a JSON pointer in the hash
     * @param [options]
     * @returns - Returns the resolved value
     */
    get(path, options) {
        return this._resolve(path, "", options).value;
    }
    /**
     * Sets the value at the given path in the schema. If the property, or any of its parents, don't exist, they will be created.
     *
     * @param path The JSON Reference path, optionally with a JSON Pointer in the hash
     * @param value The value to assign. Can be anything (object, string, number, etc.)
     */
    set(path, value) {
        const absPath = url.resolve(this._root$Ref.path, path);
        const withoutHash = url.stripHash(absPath);
        const $ref = this._$refs[withoutHash];
        if (!$ref) {
            throw ono(`Error resolving $ref pointer "${path}". \n"${withoutHash}" not found.`);
        }
        $ref.set(absPath, value);
    }
    /**
     * Returns the specified {@link $Ref} object, or undefined.
     *
     * @param path - The path being resolved, optionally with a JSON pointer in the hash
     * @returns
     * @protected
     */
    _get$Ref(path) {
        path = url.resolve(this._root$Ref.path, path);
        const withoutHash = url.stripHash(path);
        return this._$refs[withoutHash];
    }
    /**
     * Creates a new {@link $Ref} object and adds it to this {@link $Refs} object.
     *
     * @param path  - The file path or URL of the referenced file
     */
    _add(path) {
        const withoutHash = url.stripHash(path);
        const $ref = new $Ref(this);
        $ref.path = withoutHash;
        this._$refs[withoutHash] = $ref;
        this._root$Ref = this._root$Ref || $ref;
        return $ref;
    }
    /**
     * Resolves the given JSON reference.
     *
     * @param path - The path being resolved, optionally with a JSON pointer in the hash
     * @param pathFromRoot - The path of `obj` from the schema root
     * @param [options]
     * @returns
     * @protected
     */
    _resolve(path, pathFromRoot, options) {
        const absPath = url.resolve(this._root$Ref.path, path);
        const withoutHash = url.stripHash(absPath);
        const $ref = this._$refs[withoutHash];
        if (!$ref) {
            throw ono(`Error resolving $ref pointer "${path}". \n"${withoutHash}" not found.`);
        }
        return $ref.resolve(absPath, options, path, pathFromRoot);
    }
    constructor() {
        /**
         * A map of paths/urls to {@link $Ref} objects
         *
         * @type {object}
         * @protected
         */
        this._$refs = {};
        /**
         * Returns the paths of all the files/URLs that are referenced by the JSON schema,
         * including the schema itself.
         *
         * @param [types] - Only return paths of the given types ("file", "http", etc.)
         * @returns
         */
        /**
         * Returns the map of JSON references and their resolved values.
         *
         * @param [types] - Only return references of the given types ("file", "http", etc.)
         * @returns
         */
        /**
         * Returns a POJO (plain old JavaScript object) for serialization as JSON.
         *
         * @returns {object}
         */
        this.toJSON = this.values;
        /**
         * Indicates whether the schema contains any circular references.
         *
         * @type {boolean}
         */
        this.circular = false;
        this._$refs = {};
        // @ts-ignore
        this._root$Ref = null;
    }
}
/**
 * Returns the encoded and decoded paths keys of the given object.
 *
 * @param $refs - The object whose keys are URL-encoded paths
 * @param [types] - Only return paths of the given types ("file", "http", etc.)
 * @returns
 */
function getPaths($refs, types) {
    let paths = Object.keys($refs);
    // Filter the paths by type
    types = Array.isArray(types[0]) ? types[0] : Array.prototype.slice.call(types);
    if (types.length > 0 && types[0]) {
        paths = paths.filter((key) => {
            return types.includes($refs[key].pathType);
        });
    }
    // Decode local filesystem paths
    return paths.map((path) => {
        return {
            encoded: path,
            decoded: $refs[path].pathType === "file" ? url.toFileSystemPath(path, true) : path,
        };
    });
}
