/* Factory+ Java client library.
 * Well-known UUID constants.
 * Copyright 2023 AMRC.
 */

package uk.co.amrc.factoryplus;

import java.util.UUID;

/** Static well-known UUIDs.
 */
public class FPUuid {
    static final UUID FactoryPlus = UUID.fromString("11ad7b32-1d32-4c4a-b0c9-fa049208939a");
    static final UUID Null = UUID.fromString("00000000-0000-0000-0000-000000000000");

    public static class App {
        public static final UUID Registration = UUID.fromString("cb40bed5-49ad-4443-a7f5-08c75009da8f");
        public static final UUID Info = UUID.fromString("64a8bfa9-7772-45c4-9d1a-9e6290690957");
        public static final UUID SparkplugAddress = UUID.fromString("8e32801b-f35a-4cbf-a5c3-2af64d3debd7");
    }

    public static class Class {
        public static final UUID Class = UUID.fromString("04a1c90d-2295-4cbe-b33a-74eded62cbf1");
        public static final UUID Device = UUID.fromString("18773d6d-a70d-443a-b29a-3f1583195290");
        public static final UUID Schema = UUID.fromString("83ee28d4-023e-4c2c-ab86-12c24e86372c");
        public static final UUID App = UUID.fromString("d319bd87-f42b-4b66-be4f-f82ff48b93f0");
        public static final UUID Service = UUID.fromString("265d481f-87a7-4f93-8fc6-53fa64dc11bb");
    }

    public static class Service {
        public static final UUID Directory = UUID.fromString("af4a1d66-e6f7-43c4-8a67-0fa3be2b1cf9");
        public static final UUID ConfigDB = UUID.fromString("af15f175-78a0-4e05-97c0-2a0bb82b9f3b");
        public static final UUID Authentication = UUID.fromString("cab2642a-f7d9-42e5-8845-8f35affe1fd4");
        public static final UUID Command_Escalation = UUID.fromString("78ea7071-24ac-4916-8351-aa3e549d8ccd");
        public static final UUID MQTT = UUID.fromString("feb27ba3-bd2c-4916-9269-79a61ebc4a47");
    }

    public static class Schema {
        public static final UUID Device_Information = UUID.fromString("2dd093e9-1450-44c5-be8c-c0d78e48219b");
        public static final UUID Service = UUID.fromString("05688a03-730e-4cda-9932-172e2c62e45c");
    }
}
