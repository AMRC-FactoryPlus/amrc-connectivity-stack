import {logger} from "./logger.js";

/**
 * Creates a new topic to extract data from the topic path and custom properties.
 */
export class UnsTopic {
    private readonly TopicString: string;
    private readonly TopicArray: string[];
    private readonly EdgeIndex: number;
    private readonly SchemaUUIDPath: string[];
    private readonly InstanceUUIDPath: string[];
    private ISA95Schema: ISA95Schema;

    /**
     * Creates a new topic to extract data from the topic path and custom properties.
     * @param topic UNS topic the metric was published on.
     * @param properties The MQTTv5 user properties on the metric payload.
     */
    constructor(topic: string, properties: UnsMetricCustomProperties) {
        this.TopicString = topic;
        this.TopicArray = topic.split("/");
        this.EdgeIndex = this.TopicArray.indexOf("Edge");
        this.SchemaUUIDPath = properties.SchemaUUIDPath.split(':');
        this.InstanceUUIDPath = properties.InstanceUUIDPath.split(':');
    }

    /**
     * Returns ISA 95 section of the topic path.
     */
    public GetISA95Schema(): ISA95Schema | null {
        // check if its already cached.
        if (this.ISA95Schema) {
            return this.ISA95Schema;
        }

        let schema: ISA95Schema = {};
        if (this.EdgeIndex === null) {
            logger.error("Unable to find Edge in topic path");
            return null;
        }
        // our ISA95 part of the topic is between the uns version and the edge.
        const ISA95TopicSlice = this.TopicArray.slice(2, this.EdgeIndex);
        for (let i: number = 0; i < ISA95TopicSlice.length; i++) {
            switch (i) {
                case 0:
                    schema.Enterprise = ISA95TopicSlice[0]
                    break;
                case 1:
                    schema.Site = ISA95TopicSlice[1];
                    break;
                case 2:
                    schema.Area = ISA95TopicSlice[2];
                    break;
                case 3:
                    schema.WorkCenter = ISA95TopicSlice[3];
                    break;
                case 4:
                    schema.WorkUnit = ISA95TopicSlice[4];
                    break;
            }
        }
        // cache the schema to we don't have to create it again.
        this.ISA95Schema = schema;
        return schema;
    }

    /**
     * Gets the full UUID path of the schema, this does **NOT** include the top level schema UUID.
     */
    public GetSchemaFull(): string {
        const schemaUUIDArray = [...this.SchemaUUIDPath];
        // The schema full property can only have a value if the path has greater than 1 element
        if (!this.SchemaUUIDPath || schemaUUIDArray.length <= 1) {
            return "";
        }
        schemaUUIDArray.shift()
        return schemaUUIDArray.join(":");
    }

    /**
     * Gets the Top level of the schema UUID path. This is the UUID from the root schema.
     */
    public GetTopLevelSchema(): string {
        // the top level is always the first element in this path. All schema uuid path's should have
        // at least one element.
        if (!this.SchemaUUIDPath || this.SchemaUUIDPath.length === 0) {
            logger.warn("🔥 Schema UUID path has no elements.")
            return "";
        }
        return this.SchemaUUIDPath[0]
    }

    /**
     * Gets the bottom level schema UUID. This is the last schema UUID in the schema path.
     */
    public GetBottomLevelSchema(): string {
        // a bottom level schema will only be populated if we have more than two items in the schema path.
        if (!this.SchemaUUIDPath || this.SchemaUUIDPath.length <= 2) {
            return "";
        }
        return this.SchemaUUIDPath[this.SchemaUUIDPath.length - 1];
    }

    /**
     * Gets the full UUID instance path, this does **NOT** include the top level instance UUID.
     */
    public GetInstanceFull(): string {
        const instanceUUIDArray = [...this.InstanceUUIDPath];
        // The instance full property can only have a value if the path has greater than one element.
        if (!this.InstanceUUIDPath || instanceUUIDArray.length <= 1) {
            return "";
        }
        instanceUUIDArray.shift()
        return instanceUUIDArray.join(":");
    }

    /**
     * Gets the Top level of the instance UUID path. This is the UUID from the root instance.
     */
    public GetTopLevelInstance(): string {
        // the top level is always the first element in this path. All instance uuid path should have
        // at least one element.
        if (!this.InstanceUUIDPath || this.InstanceUUIDPath.length === 0) {
            logger.warn("🔥 Schema UUID path has no elements.")
            return "";
        }
        return this.InstanceUUIDPath[0]
    }

    /**
     * Gets the bottom level instance UUID. This is the last instance UUID in the instance path.
     */
    public GetBottomLevelInstance(): string {
        // a bottom level instance will only be populated if we have more than two items in the schema path.
        if (!this.InstanceUUIDPath || this.InstanceUUIDPath.length <= 2) {
            return "";
        }
        return this.InstanceUUIDPath[this.InstanceUUIDPath.length - 1];
    }

    /**
     * Gets the full path of the metric, excluding the ISA95 portion of the topic.
     */
    public GetMetricPath() {
        return this.TopicArray.slice(this.EdgeIndex + 1, -1).join("/");
    }

    /**
     * Gets the name of the metric which is the last element in the schema path.
     */
    public GetMetricName() {
        return this.TopicArray[this.TopicArray.length - 1];
    }
}