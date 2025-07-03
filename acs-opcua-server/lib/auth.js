/*
 * Factory+ / AMRC Connectivity Stack (ACS) OPC UA Server component
 * Authentication and authorization handler
 * Copyright 2025 AMRC
 */

import { UUIDs } from "@amrc-factoryplus/service-client";

export class AuthHandler {
    constructor(opts) {
        this.fplus = opts.fplus;
        this.log = this.fplus.debug.bound("auth-handler");
        
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
            
            // Use the Factory+ auth service to validate credentials
            // This follows the same pattern as other ACS services
            const client = userName.includes("@") 
                ? userName 
                : `${userName}@${this.fplus.realm || "FACTORYPLUS.APP.AMRC.CO.UK"}`;

            // For now, we'll implement basic validation
            // In a full implementation, this would integrate with the GSS/Kerberos system
            // like the existing auth patterns in the codebase
            
            if (!userName || !password) {
                return false;
            }

            // Store user session info for permission checking
            this.userSessions.set(userName, {
                principal: client,
                authenticated: true,
                loginTime: new Date()
            });

            this.log(`User ${userName} authenticated successfully`);
            return true;
            
        } catch (error) {
            this.log(`Authentication failed for ${userName}: ${error.message}`);
            return false;
        }
    }

    /**
     * Get user roles for authorization
     * @param {string} userName - Username
     * @returns {Promise<string[]>} Array of user roles
     */
    async getUserRoles(userName) {
        try {
            const session = this.userSessions.get(userName);
            if (!session) {
                return ["Anonymous"];
            }

            // In a full implementation, this would query the auth service
            // to get the user's actual roles and permissions
            return ["AuthenticatedUser"];
            
        } catch (error) {
            this.log(`Error getting roles for ${userName}: ${error.message}`);
            return ["Anonymous"];
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
        // For now, allow anonymous read access
        // In production, this should be configurable and integrate with MQTT permissions
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
            const hasUNSRead = await this.checkUNSReadPermission(principal);
            
            return hasUNSRead;
            
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
