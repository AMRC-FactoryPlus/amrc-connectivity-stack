import {UMetric, UPayload} from "../lib/sparkplugpayload";

export class Address {
    constructor(group: string, node: string, device?: string);
    group: string;
    node: string;
    device: string | undefined;

    static parse(addr: string): Address;

    /**
     * Check for exact match of address.
     * @param other Address object to be compared against.
     */
    equals(other: Address): boolean;

    /**
     * Check for a match. Allows address to have wildcard.
     * @param other Address object to be compared against.
     */
    matches(other: Address): boolean;

    /**
     * Stringifies the address in Group/Node/Device format.
     */
    toString(): string;

    /**
     * Returns boolean if Address is a device
     */
    isDevice(): boolean;

    /**
     * Returns type of topic
     */
    topicKind(): string;

    /**
     * Returns a string containing an MQTT topic for this address.
     * The type is one of BIRTH, DEATH, DATA, CMD or + to represent a wildcard type for MQTT subscription.
     * Note that the initial N or D is added automatically.
     * @param type Type of message to generate
     */
    topic(type: string): Topic;

    /**
     * Returns an Address representing the Node part of this address.
     * If the Address already represents a Node, returns a new object representing the same address.
     */
    parent_node(): Address;

    /**
     * If this is a Node address, return the Address of a child Device.
     * @param device Device Name
     */
    children_device(device: string): Address;

    /**
     * Returns true if the device address is a child of the node
     * @param node Node Address
     */
    is_child_of(node: Address): boolean;
}

export class Topic {
    constructor(address: Address, type: string);
    static prefix: string;
    address: Address;
    type: string;

    /**
     * Parse a string containing an MQTT topic name and return a Topic object. Return null if invalid
     * @param topic string of a topic
     */
    static parse(topic: string): Topic | null;

    /**
     * Returns a string containing the topic name.
     */
    toString(): string;
}

export const MetricBuilder: {
    birth: {
        node: (metrics: UMetric[]) => UMetric[],
        device: (metrics: UMetric[]) => UMetric[],
        command_escalation: (metrics: UMetric[]) => UMetric[],
    }
    death: {
        node: (metrics: UMetric[]) => UMetric[],
    },
    data: {
        command_escalation: (addr: Address, metric: string, value: string) => UMetric[],
    },
    cmd: {
        command_escalation_response: (addr: Address, metric: string, stat: number) => UMetric[],
    }
}

export class MetricBranch {}

export class MetricTree {
    constructor(payload: UPayload)
}
