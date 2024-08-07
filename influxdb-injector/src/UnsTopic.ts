import {logger} from "./logger.js";

interface ISA95Schema {
    Enterprise?: string,
    Site?: string,
    Area?: string,
    WorkCenter?: string,
    WorkUnit?: string
}

export class UnsTopic {
    private readonly TopicString: string;
    private readonly TopicArray: string[];
    private readonly EdgeIndex: number;
    public ISA95Schema: ISA95Schema;
    public SchemaPath: string;
    public TopLevelSchema: string;
    public BottomLevelSchema: string;
    public MetricName: string;
    public Path: string;

    constructor(topic: string) {
        this.TopicString = topic;
        this.TopicArray = topic.split("/");
        this.Path = topic;
        this.EdgeIndex = this.TopicArray.indexOf("Edge");
        this.ISA95Schema = this.GetISA95Schema();
        this.TopLevelSchema = this.GetTopLevelSchema();
        this.BottomLevelSchema = this.GetBottomLevelSchema();
        this.SchemaPath = this.GetSchemaPath();
        this.MetricName = this.GetMetricName();
    }

    /**
     * Return ISA 95 section of the topic path
     */
    private GetISA95Schema(): ISA95Schema | null {
        let schema: ISA95Schema = {};
        if (this.EdgeIndex === null) {
            logger.error("Unable to find Edge in topic path");
            return null;
        }
        // our isa 95 part of the topic is between the uns version and the edge.
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
        return schema;
    }

    /**
     *
     */
    private GetTopLevelSchema(): string {
        // the metric schema is from the edge node to the last item of the path
        const schemaSlice = this.TopicArray.slice(this.EdgeIndex + 1, -1);
        return schemaSlice[0];
    }

    /**
     *
     */
    public GetBottomLevelSchema(): string {
        return this.TopicArray[-1];
    }

    /**
     *
     */
    private GetSchemaPath() {
        return this.TopicArray.slice(this.EdgeIndex, -1).join("/");
    }

    private GetMetricName() {
        return this.TopicArray[-1];
    }


}