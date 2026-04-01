/*
 * Pure mapping/translation functions between Factory+ and i3X data models.
 *
 * These are all pure functions with no side effects.
 */

import type {
    I3xNamespace,
    I3xObjectType,
    I3xObject,
    I3xVqt,
    I3xQuality,
    I3xRelationshipType,
    I3xSuccess,
    I3xError,
    I3xBulkItem,
    I3xBulkResponse,
} from "./types/i3x.js";

export function toI3xNamespace(name: string, uri: string): I3xNamespace {
    return { uri, displayName: name };
}

export function toI3xObjectType(
    elementId: string,
    displayName: string,
    namespaceUri: string,
    sourceTypeId: string,
    schema: object,
): I3xObjectType {
    return { elementId, displayName, namespaceUri, sourceTypeId, schema };
}

export function toI3xObject(
    elementId: string,
    displayName: string,
    typeElementId: string,
    parentId: string | null,
    isComposition: boolean,
): I3xObject {
    return {
        elementId,
        displayName,
        typeElementId,
        parentId,
        isComposition,
        isExtended: false,
    };
}

export function toI3xVqt(
    value: unknown,
    quality: I3xQuality,
    timestamp: Date | string,
): I3xVqt {
    return {
        value,
        quality,
        timestamp: timestamp instanceof Date
            ? timestamp.toISOString()
            : timestamp,
    };
}

export function toI3xRelationshipType(
    elementId: string,
    displayName: string,
    namespaceUri: string,
    relationshipId: string,
    reverseOf: string,
): I3xRelationshipType {
    return { elementId, displayName, namespaceUri, relationshipId, reverseOf };
}

export function wrapResponse<T>(result: T): I3xSuccess<T> {
    return { success: true, result };
}

export function wrapError(message: string): I3xError {
    return { success: false, error: { message } };
}

export function wrapBulkResponse<T>(items: I3xBulkItem<T>[]): I3xBulkResponse<T> {
    return {
        success: items.every(item => item.success),
        results: items,
    };
}
