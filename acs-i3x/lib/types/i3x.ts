/*
 * i3X type definitions
 *
 * These types define the complete i3X data model, request/response shapes,
 * and server info as specified in the i3X 1.0 specification.
 */

/* Response envelopes */

export interface I3xSuccess<T> {
    success: true;
    result: T;
}

/** Why a request, or one item of a bulk request, failed, or why a
 * successful response is partial (RFC 9457 problem details). */
export interface I3xResponseDetail {
    title: string;
    status: number;
    detail: string;
}

export interface I3xError {
    success: false;
    responseDetail: I3xResponseDetail;
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
    responseDetail: I3xResponseDetail;
}

export type I3xBulkItem<T> = I3xBulkItemSuccess<T> | I3xBulkItemError;

export interface I3xBulkResponse<T> {
    success: boolean;
    results: I3xBulkItem<T>[];
}

export interface I3xSubscriptionBulkItemSuccess<T> {
    success: true;
    subscriptionId: string;
    result: T;
}

export interface I3xSubscriptionBulkItemError {
    success: false;
    subscriptionId: string;
    responseDetail: I3xResponseDetail;
}

export type I3xSubscriptionBulkItem<T> =
    | I3xSubscriptionBulkItemSuccess<T>
    | I3xSubscriptionBulkItemError;

export interface I3xSubscriptionBulkResponse<T> {
    success: boolean;
    results: I3xSubscriptionBulkItem<T>[];
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

export interface I3xObjectMetadata {
    description?: string;
    typeNamespaceUri: string;
    sourceTypeId: string;
    /* The ids at the other end of the object's edges, by relationship
     * type. */
    relationships?: Record<string, string | string[]>;
}

export interface I3xObjectWithMetadata extends I3xObject {
    metadata: I3xObjectMetadata;
}

/** One edge from an object: the relationship type that leads from it to
 * `object`. */
export interface I3xRelated {
    sourceRelationship: string;
    object: I3xObject;
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
    isComposition: boolean;
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
    monitoredObjects?: Array<{ elementId: string; maxDepth: number }>;
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
    elementId: string;
}

/** The updates a /sync call found waiting, under the number the client
 * acknowledges them by. */
export interface I3xSyncBatch {
    sequenceNumber: number;
    updates: I3xSyncItem[];
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
