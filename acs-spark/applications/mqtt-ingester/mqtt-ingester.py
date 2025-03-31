import os
import logging
from pyspark.sql import SparkSession
from pyspark.sql.functions import from_json
from pyspark.sql.types import StructType, StructField, StringType

def main():
    logging.basicConfig(
        level=logging.INFO, 
        format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
    )

    # Create SparkSession with Delta Lake and S3 (Minio) configurations
    spark = SparkSession.builder \
        .appName("KafkaToDeltaMinio") \
        .config("fs.s3a.access.key", os.getenv("AWS_ACCESS_KEY_ID")) \
        .config("fs.s3a.secret.key", os.getenv("AWS_SECRET_ACCESS_KEY")) \
        .config("fs.s3a.endpoint", "https://minio.factory-plus.svc.cluster.local") \
        .config("spark.hadoop.fs.s3a.path.style.access", "true") \
        .config("spark.sql.extensions", "io.delta.sql.DeltaSparkSessionExtension") \
        .config("spark.sql.catalog.spark_catalog", "org.apache.spark.sql.delta.catalog.DeltaCatalog") \
        .getOrCreate()

    # Read streaming data from Kafka
    kafka_df = spark.readStream.format("kafka") \
        .option("kafka.bootstrap.servers", "acs-kafka.factory-plus.svc.cluster.local:9092") \
        .option("subscribe", "mqtt_data") \
        .load()

    # Define the schema of your JSON data coming from Kafka to match the posted data structure
    json_schema = StructType([
        StructField("measurement", StringType(), True),
        StructField("type", StringType(), True),
        StructField("value", StringType(), True),
        StructField("timestamp", StringType(), True),
        StructField("tags", StructType([
            StructField("metricName", StringType(), True),
            StructField("topLevelInstance", StringType(), True),
            StructField("bottomLevelInstance", StringType(), True),
            StructField("usesInstances", StringType(), True),
            StructField("topLevelSchema", StringType(), True),
            StructField("bottomLevelSchema", StringType(), True),
            StructField("usesSchemas", StringType(), True),
            StructField("enterprise", StringType(), True),
            StructField("site", StringType(), True),
            StructField("area", StringType(), True),
            StructField("workCenter", StringType(), True),
            StructField("workUnit", StringType(), True),
            StructField("path", StringType(), True),
            StructField("unit", StringType(), True)
        ]), True)
    ])

    parsed_df = kafka_df.selectExpr("CAST(value AS STRING) as json_str") \
        .select(from_json("json_str", json_schema).alias("data")) \
        .select("data.*")

    # Write the stream to a Delta table stored in Minio (S3a)
    query = parsed_df.writeStream \
        .format("delta") \
        .option("checkpointLocation", "s3a://deltalake/delta-checkpoint/") \
        .outputMode("append") \
        .start("s3a://deltalake/bronze")

    query.awaitTermination()

if __name__ == "__main__":
    main()
