/*
 * i3X type definitions
 *
 * These types define the complete i3X data model, request/response shapes,
 * and server info as specified in the i3X specification (main branch).
 */

/* Response envelopes */

export interface I3xSuccess<T> {
    success: true;
    result: T;
}

export interface I3xError {
    success: false;
    error: { message: string };
}

export type I3xResponse<T> = I3xSuccess<T> | I3xError;

export interface I3xBulkItemSuccess<T> {
    success: true;
    elementId: string;
    result: T;
}

export interface I3xBulkItemError {
    success: false;
    elementId: string;
    error: { message: string };
}

export type I3xBulkItem<T> = I3xBulkItemSuccess<T> | I3xBulkItemError;

export interface I3xBulkResponse<T> {
    success: boolean;
    results: I3xBulkItem<T>[];
}

/* Data model */

export interface I3xNamespace {
    uri: string;
    displayName: string;
}

export interface I3xObjectType {
    elementId: string;
    displayName: string;
    namespaceUri: string;
    sourceTypeId: string;
    schema: object;
}

export interface I3xObject {
    elementId: string;
    displayName: string;
    typeElementId: string;
    parentId: string | null;
    isComposition: boolean;
    isExtended: boolean;
}

export interface I3xObjectWithMetadata extends I3xObject {
    metadata: {
        description?: string;
        typeNamespaceUri: string;
        sourceTypeId: string;
        relationships?: Record<string, string | string[]>;
    };
}

export interface I3xRelationshipType {
    elementId: string;
    displayName: string;
    namespaceUri: string;
    relationshipId: string;
    reverseOf: string;
}

export type I3xQuality = "Good" | "GoodNoData" | "Bad" | "Uncertain";

export interface I3xVqt {
    value: unknown;
    quality: I3xQuality;
    timestamp: string;
}

export interface I3xValueResponse extends I3xVqt {
    elementId: string;
    isComposition: boolean;
    components?: Record<string, I3xVqt>;
}

export interface I3xHistoryItem {
    elementId: string;
    values: I3xVqt[];
}

/* Requests */

export interface I3xBulkRequest {
    elementIds: string[];
}

export interface I3xValueRequest extends I3xBulkRequest {
    maxDepth?: number;
}

export interface I3xHistoryRequest extends I3xBulkRequest {
    startTime: string;
    endTime: string;
    maxDepth?: number;
}

export interface I3xSubscriptionCreateRequest {
    clientId: string;
    displayName?: string;
}

export interface I3xSubscription {
    clientId: string;
    subscriptionId: string;
    displayName: string;
}

export interface I3xSubscriptionListRequest {
    clientId: string;
    subscriptionIds: string[];
}

export interface I3xSubscriptionDeleteRequest {
    clientId: string;
    subscriptionIds: string[];
}

export interface I3xRegisterRequest {
    clientId: string;
    subscriptionId: string;
    elementIds: string[];
    maxDepth?: number;
}

export interface I3xStreamRequest {
    clientId: string;
    subscriptionId: string;
}

export interface I3xSyncRequest {
    clientId: string;
    subscriptionId: string;
    lastSequenceNumber?: number;
}

export interface I3xSyncItem extends I3xVqt {
    sequenceNumber: number;
    elementId: string;
}

/* Server info */

export interface I3xServerInfo {
    specVersion: string;
    serverName: string;
    serverVersion: string;
    capabilities: {
        query: {
            history: boolean;
        };
        update: {
            current: boolean;
            history: boolean;
        };
        subscribe: {
            stream: boolean;
        };
    };
}
