import { ZipArchive } from "archiver";
import { PassThrough } from "stream";
import { once } from "events";
import pLimit from "p-limit";

export class InfluxReader {
    constructor(opts) {
        this.log = opts.debug.bound("influxReader");

        this.influx_bucket = opts.influx_bucket;
        this.influx_org = opts.influx_org;

        this.influx_query_api =
            opts.influx_client.getQueryApi(
                this.influx_org
            );

        this.limit = pLimit(4);
    }

    exportDevices(deviceSources, meta = {}) {
        const archive = new ZipArchive({
            zlib: {
                level: 0,
            },
        });

        archive.on("warning", err => {
            this.log("archive warning", err);
        });

        archive.on("error", err => {
            this.log("archive error", err);
            archive.destroy(err);
        });

        this.#appendDevices(
            archive,
            deviceSources,
            meta
        ).catch(err => {
            archive.destroy(err);
        });

        return archive;
    }

    async #appendDevices(archive, deviceSources, meta) {
        for (const source of deviceSources) {
            await this.limit(() =>
                new Promise((resolve, reject) => {
                    const csvStream = new PassThrough({
                        highWaterMark: 1024 * 1024,
                    });

                    archive.append(csvStream, {
                        name: `${source.device_uuid}.csv`,
                    });

                    this.#streamDevice(source, csvStream, meta)
                        .then(resolve)
                        .catch(reject);
                })
            );
        }

        await new Promise((resolve, reject) => {
            archive.once("error", reject);
            archive.once("close", resolve);
            archive.finalize();
        });
    }

    async #streamDevice(
        source,
        writable,
        meta
    ) {
        const query =
            this.#buildFluxQuery(
                source,
                meta
            );

        this.log(
            "streaming",
            source.device_uuid
        );

        const response =
            this.influx_query_api.response(query);

        try {
            for await (
                const chunk of response.iterateLines()
            ) {
                if (
                    !writable.write(
                        chunk + "\n"
                    )
                ) {
                    await once(
                        writable,
                        "drain"
                    );
                }
            }

            writable.end();

            await once(
                writable,
                "finish"
            );
        }
        catch (err) {
            writable.destroy(err);
            throw err;
        }
    }

    #buildFluxQuery(
        source,
        meta = {}
    ) {
        const start =
            source.from ??
            "1970-01-01T00:00:00Z";

        const stop =
            source.to ??
            "2100-01-01T00:00:00Z";

        const measurementFilter =
            meta.measurement
                ? `
                |> filter(
                    fn: (r) =>
                        r._measurement ==
                        "${meta.measurement}"
                )
            `
                : "";

        return `
            from(bucket: "${this.influx_bucket}")

            |> range(
                start: time(v: "${start}"),
                stop: time(v: "${stop}")
            )

            ${measurementFilter}

            |> filter(
                fn: (r) =>
                    r.topLevelInstance ==
                    "${source.device_uuid}"
            )
        `;
    }
}