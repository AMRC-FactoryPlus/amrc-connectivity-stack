/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

/**
 * Convert strings to a valid Kubernetes resource name (RFC 1123 subdomain).
 * Joins parts with hyphens, lowercases, removes invalid characters, and
 * trims leading/trailing hyphens.
 *
 * @param {...string} parts - The string parts to join and normalize
 * @returns {string} - A valid k8s resource name
 */
export function k8sname(...parts) {
    return parts.join("-")
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, "-")
        .replace(/^-|-$/g, "");
}
