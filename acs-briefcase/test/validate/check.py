"""
ACS Briefcase exporter
Check a briefcase with the tools researchers will use
Copyright 2026 University of Sheffield

Usage: python check.py <briefcase.zip>

The bag must pass the Library of Congress BagIt validator, the RO-Crate
must pass every required RO-Crate 1.3 check, and each Parquet file must
read back in pyarrow with the agreed types and exactly the data points of
its CSV file.
"""

import csv
import json
import subprocess
import sys
import tempfile
import zipfile
from datetime import datetime, timezone
from pathlib import Path

import bagit
import pyarrow as pa
import pyarrow.parquet as pq

SCHEMA = pa.schema([
    pa.field("timestamp", pa.timestamp("us", tz="UTC"), nullable=False),
    pa.field("timestamp_ns", pa.int64(), nullable=False),
    pa.field("metric", pa.string(), nullable=False),
    pa.field("type", pa.string(), nullable=False),
    ("unit", pa.string()),
    ("value_double", pa.float64()),
    ("value_int", pa.int64()),
    ("value_uint", pa.uint64()),
    ("value_boolean", pa.bool_()),
    ("value_string", pa.string()),
])

READ = {
    "double": float,
    "int": int,
    "uint": int,
    "boolean": {"true": True, "false": False}.__getitem__,
    "string": str,
}


def time_ns(ts):
    """Nanoseconds since the epoch, from a CSV timestamp."""
    whole = datetime.strptime(ts[:19], "%Y-%m-%dT%H:%M:%S")
    seconds = int(whole.replace(tzinfo=timezone.utc).timestamp())
    assert ts[19] == "." and ts[29:] == "Z", ts
    return seconds * 1_000_000_000 + int(ts[20:29])


def check_parquet(csv_file, parquet_file):
    table = pq.read_table(parquet_file)
    assert table.schema.remove_metadata() == SCHEMA, table.schema

    columns = table.to_pydict()
    columns["timestamp"] = table.column("timestamp").cast(pa.int64()).to_pylist()

    with open(csv_file, newline="", encoding="utf-8") as f:
        rows = list(csv.DictReader(f))
    assert len(rows) == table.num_rows, (len(rows), table.num_rows)

    for i, row in enumerate(rows):
        ns = time_ns(row["timestamp"])
        assert columns["timestamp_ns"][i] == ns, (i, row)
        assert columns["timestamp"][i] == ns // 1000, (i, row)
        for name in ("metric", "type"):
            assert columns[name][i] == row[name], (i, name, row)
        assert columns["unit"][i] == (row["unit"] or None), (i, row)
        for kind, read in READ.items():
            want = read(row["value"]) if kind == row["type"] else None
            assert columns[f"value_{kind}"][i] == want, (i, kind, row)

    return table.num_rows


def check_crate(data):
    out = subprocess.run(
        ["rocrate-validator", "validate", "-p", "ro-crate-1.3",
         "--no-paging", "-f", "json", str(data)],
        capture_output=True, text=True)
    report = json.loads(out.stdout)
    for issue in report.get("issues", []):
        print("  RO-Crate:", issue.get("severity"), issue.get("message"))
    assert report["passed"], "the RO-Crate is not valid"


def main(zip_file):
    with tempfile.TemporaryDirectory() as tmp:
        zipfile.ZipFile(zip_file).extractall(tmp)
        [root] = Path(tmp).iterdir()

        bagit.Bag(str(root)).validate()
        print("BagIt: valid")

        check_crate(root / "data")
        print("RO-Crate: every required check passes")

        telemetry = root / "data" / "telemetry"
        csvs = sorted((telemetry / "csv").glob("*.csv"))
        assert csvs, "no telemetry"
        for csv_file in csvs:
            parquet_file = telemetry / "parquet" / f"{csv_file.stem}.parquet"
            rows = check_parquet(csv_file, parquet_file)
            print(f"Parquet: {csv_file.stem} matches its CSV, {rows} rows")


if __name__ == "__main__":
    main(sys.argv[1])
