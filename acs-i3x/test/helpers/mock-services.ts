import { jest } from "@jest/globals";

export function createMockFplus() {
    return {
        ConfigDB: {
            class_members: jest.fn<() => Promise<string[]>>().mockResolvedValue([]),
            get_config: jest.fn<() => Promise<any>>().mockResolvedValue(null),
        },
        Directory: {
            get_device_info: jest.fn<() => Promise<any>>().mockResolvedValue({ online: false }),
        },
        debug: {
            bound: () => (..._args: any[]) => {},
        },
    };
}
