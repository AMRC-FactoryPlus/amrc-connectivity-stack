/*
 * Copyright (c) University of Sheffield AMRC 2025.
 */

import GSS from "gssapi.js";

export class AuthHandler {
    constructor(opts) {
        this.fplus = opts.fplus;
        this.log = this.fplus.debug.bound("auth-handler");

        this.realm = opts.realm;
        this.principal = `OPCUA/${opts.hostname}`;
        this.keytab = opts.keytab;

        this.userSessions = new Map(); // Track user sessions and their permissions
    }

    async init() {
        this.log("Initializing authentication handler...");
        // Any initialization needed for auth
    }

    /**
     * Validate user credentials for OPC UA authentication
     * @param {string} userName - Username
     * @param {string} password - Password
     * @returns {Promise<boolean>} True if valid user
     */
    async isValidUser(userName, password) {
        try {
            this.log(`Authenticating user: ${userName}`);

            if (!userName || !password) {
                this.log("Missing username or password");
                return false;
            }

            // Construct the full principal name if not already provided
            const client = user.includes("@") ? user : `${user}@${this.realm}`;

            // Use Factory+ service client to validate credentials
            // This creates a new service client with the provided credentials
            // and attempts to authenticate with the Factory+ auth service
            try {

                res = await GSS.verifyCredentials(client, password, {
                    keytab: `FILE:${this.keytab}`,
                    serverPrincipal: this.principal,
                });

                this.log("GSSAPI verify credentials reponse: %O", res);

                const { ServiceClient } = await import("@amrc-factoryplus/service-client");

                // Create a service client with the user's credentials
                const userClient = await new ServiceClient({
                    env: {
                        ...process.env,
                        SERVICE_USERNAME: client,
                        SERVICE_PASSWORD: password
                    }
                }).init();

                this.log(userClient)

                // If we get here, authentication was successful
                this.log(`User ${userName} authenticated successfully as ${client}`);

                // Store user session info for permission checking
                this.userSessions.set(userName, {
                    principal: client,
                    authenticated: true,
                    loginTime: new Date(),
                    serviceClient: userClient
                });

                return true;

            } catch (authError) {
                this.log(`Factory+ authentication failed for ${client}: ${authError.message}`);
                return false;
            }

        } catch (error) {
            this.log(`Authentication error for ${userName}: ${error.message}`);
            return false;
        }
    }

    /**
     * Get user roles for authorization
     * @param {string} userName - Username
     * @returns {Array} Array of role objects with namespace and value properties
     */
    getUserRoles(userName) {
        try {
            const session = this.userSessions.get(userName);
            if (!session) {
                // Return Anonymous role for unauthenticated users
                return [{ namespace: 0, value: 1 }]; // Anonymous = 1
            }

            // Return AuthenticatedUser role for authenticated users
            // Based on OPC UA Well-Known Roles: AuthenticatedUser = 2
            return [{ namespace: 0, value: 2 }]; // AuthenticatedUser = 2

        } catch (error) {
            this.log(`Error getting roles for ${userName}: ${error.message}`);
            return [{ namespace: 0, value: 1 }]; // Anonymous = 1
        }
    }

    /**
     * Check if a user has permission to read a specific path
     * @param {string} userName - Username (null for anonymous)
     * @param {string} path - The data path being accessed
     * @returns {Promise<boolean>} True if user has read permission
     */
    async hasReadPermission(userName, path) {
        try {
            // For anonymous users, check if anonymous access is allowed
            if (!userName) {
                return await this.checkAnonymousReadPermission(path);
            }

            const session = this.userSessions.get(userName);
            if (!session) {
                return false;
            }

            // Check MQTT permissions for the user
            // This would integrate with the existing MQTT permission system
            return await this.checkMQTTReadPermission(session.principal, path);

        } catch (error) {
            this.log(`Error checking read permission for ${userName} on ${path}: ${error.message}`);
            return false;
        }
    }

    /**
     * Check anonymous read permissions
     * @param {string} path - The data path
     * @returns {Promise<boolean>} True if anonymous read is allowed
     */
    async checkAnonymousReadPermission(path) {
        // Temporarily allow anonymous access for debugging data structure
        this.log(`Allowing anonymous access to ${path} for debugging`);
        return true;
    }

    /**
     * Check MQTT read permissions for a user
     * @param {string} principal - User principal
     * @param {string} path - The data path
     * @returns {Promise<boolean>} True if user has MQTT read permission
     */
    async checkMQTTReadPermission(principal, path) {
        try {
            // Convert the OPC UA path to MQTT topic format
            const mqttTopic = this.pathToMQTTTopic(path);

            // This would integrate with the existing MQTT permission checking
            // For now, we'll implement a basic check

            // Check if user has UNS read permissions
            // This follows the pattern from the UNS permission dumps
            return await this.checkUNSReadPermission(principal);

        } catch (error) {
            this.log(`Error checking MQTT permission: ${error.message}`);
            return false;
        }
    }

    /**
     * Check if user has UNS read permissions
     * @param {string} principal - User principal
     * @returns {Promise<boolean>} True if user has UNS read permission
     */
    async checkUNSReadPermission(principal) {
        try {
            // This would query the auth service to check if the user has
            // the UNS.Perm.ReadEntireUNS permission or equivalent
            // For now, return true for authenticated users
            return true;

        } catch (error) {
            this.log(`Error checking UNS read permission: ${error.message}`);
            return false;
        }
    }

    /**
     * Convert OPC UA path to MQTT topic format
     * @param {string} path - OPC UA path (group/node/device/path/measurement)
     * @returns {string} MQTT topic
     */
    pathToMQTTTopic(path) {
        // Convert from OPC UA path format to UNS MQTT topic format
        // OPC UA: group/node/device/path/measurement
        // MQTT: UNS/v1/group/node/device/path/measurement

        return `UNS/v1/${path}`;
    }

    /**
     * Clean up expired user sessions
     */
    cleanupSessions() {
        const now = new Date();
        const maxAge = 24 * 60 * 60 * 1000; // 24 hours

        for (const [userName, session] of this.userSessions.entries()) {
            if (now - session.loginTime > maxAge) {
                this.userSessions.delete(userName);
                this.log(`Cleaned up expired session for ${userName}`);
            }
        }
    }

    /**
     * Get session info for a user
     * @param {string} userName - Username
     * @returns {Object|null} Session info or null if not found
     */
    getSession(userName) {
        return this.userSessions.get(userName) || null;
    }

    /**
     * Remove a user session
     * @param {string} userName - Username
     */
    removeSession(userName) {
        this.userSessions.delete(userName);
        this.log(`Removed session for ${userName}`);
    }
}
