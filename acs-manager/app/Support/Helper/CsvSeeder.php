<?php
/*
 *  Factory+ / AMRC Connectivity Stack (ACS) Manager component
 *  Copyright 2023 AMRC
 */

namespace App\Support\Helper;

use Exception;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Log;

/**
 * Taken from http://laravelsnippets.com/snippets/seeding-database-with-csv-files-cleanly
 * and modified to include insert chunking
 */
class CsvSeeder extends Seeder
{
    /**
     * DB table name
     *
     * @var string
     */
    public $table;

    /**
     * CSV filename
     *
     * @var string
     */
    public $filename;

    /**
     * DB field that to be hashed, most likely a password field.
     * If your password has a different name, please overload this
     * variable from our seeder class.
     *
     * @var string
     */
    public $hashable = 'password';

    /**
     * An SQL INSERT query will execute every time this number of rows
     * are read from the CSV. Without this, large INSERTS will silently
     * fail.
     *
     * @var int
     */
    public $insert_chunk_size = 50;

    /**
     * CSV delimiter (defaults to ,)
     *
     * @var string
     */
    public $csv_delimiter = ',';

    /**
     * Number of rows to skip at the start of the CSV
     *
     * @var int
     */
    public $offset_rows = 0;

    /**
     * The mapping of CSV to DB column. If not specified manually, the first
     * row (after offset_rows) of your CSV will be read as your DB columns.
     *
     * IE to read the first, third and fourth columns of your CSV only, use:
     * array(
     *   0 => id,
     *   2 => name,
     *   3 => description,
     * )
     *
     * @var array
     */
    public $mapping = [];

    /**
     * Run DB seed
     */
    public function run()
    {
        $this->seedFromCSV($this->filename, $this->csv_delimiter);
    }

    /**
     * Strip UTF-8 BOM characters from the start of a string
     *
     * @param  string  $text
     * @return string       String with BOM stripped
     */
    public function stripUtf8Bom($text)
    {
        $bom = pack('H*', 'EFBBBF');
        $text = preg_replace("/^{$bom}/", '', $text);

        return $text;
    }

    /**
     * Opens a CSV file and returns it as a resource
     *
     *
     * @return false|resource
     */
    public function openCSV($filename)
    {
        if (! file_exists($filename) || ! is_readable($filename)) {
            Log::debug('CSV insert failed: CSV ' . $filename . ' does not exist or is not readable.');

            return false;
        }

        // check if file is gzipped
        $finfo = finfo_open(FILEINFO_MIME_TYPE);
        $file_mime_type = finfo_file($finfo, $filename);
        finfo_close($finfo);
        $gzipped = strcmp($file_mime_type, 'application/x-gzip') == 0;

        $handle = $gzipped ? gzopen($filename, 'r') : fopen($filename, 'r');

        return $handle;
    }

    /**
     * Collect data from a given CSV file and return as array
     *
     * @param  string  $filename
     * @param  string  $deliminator
     * @return array|bool
     */
    public function seedFromCSV($filename, $deliminator = ',')
    {
        $handle = $this->openCSV($filename);

        // CSV doesn't exist or couldn't be read from.
        if ($handle === false) {
            return [];
        }

        $header = null;
        $row_count = 0;
        $data = [];
        $mapping = $this->mapping ?: [];
        $offset = $this->offset_rows;

        while (($row = fgetcsv($handle, 0, $deliminator)) !== false) {
            // Offset the specified number of rows

            while ($offset > 0) {
                $offset--;

                continue 2;
            }

            // No mapping specified - grab the first CSV row and use it
            if (! $mapping) {
                $mapping = $row;
                $mapping[0] = $this->stripUtf8Bom($mapping[0]);

                // skip csv columns that don't exist in the database
                foreach ($mapping as $index => $fieldname) {
                    if (! DB::getSchemaBuilder()->hasColumn($this->table, $fieldname)) {
                        array_pull($mapping, $index);
                    }
                }
            } else {
                $row = $this->readRow($row, $mapping);

                // insert only non-empty rows from the csv file
                //                if ( !$row )
                //                    continue;

                $data[$row_count] = $row;

                // Chunk size reached, insert
                if (++$row_count == $this->insert_chunk_size) {
                    $this->insert($data);
                    $row_count = 0;
                    // clear the data array explicitly when it was inserted so
                    // that nothing is left, otherwise a leftover scenario can
                    // cause duplicate inserts
                    $data = [];
                }
            }
        }

        // Insert any leftover rows
        //check if the data array explicitly if there are any values left to be inserted, if insert them
        if (count($data)) {
            $this->insert($data);
        }

        fclose($handle);

        return $data;
    }

    /**
     * Read a CSV row into a DB insertable array
     *
     * @param  array  $row List of CSV columns
     * @param  array  $mapping Array of csvCol => dbCol
     * @return array
     */
    public function readRow(array $row, array $mapping)
    {
        $row_values = [];

        foreach ($mapping as $csvCol => $dbCol) {
            if (! isset($row[$csvCol]) || $row[$csvCol] === '') {
                $row_values[$dbCol] = null;
            } else {
                $row_values[$dbCol] = $row[$csvCol];
            }
        }

        if ($this->hashable && isset($row_values[$this->hashable])) {
            $row_values[$this->hashable] = Hash::make($row_values[$this->hashable]);
        }

        return $row_values;
    }

    /**
     * Seed a given set of data to the DB
     *
     *
     * @return bool   TRUE on success else FALSE
     */
    public function insert(array $seedData)
    {
        try {
            DB::table($this->table)->insert($seedData);
        } catch (Exception $e) {
            Log::error('CSV insert failed: ' . $e->getMessage() . ' - CSV ' . $this->filename);

            return false;
        }

        return true;
    }
}
/*
 *  Factory+ / AMRC Connectivity Stack (ACS) Manager component
 *  Copyright 2023 AMRC
 */
