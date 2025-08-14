import fs from "node:fs/promises";
import path from 'path';

export async function clean_up(opts) {
    const uploadPath = opts.path;

    console.log("Running cleaning up...");
    let files = [];
    try {
        files = await fs.readdir(uploadPath);
    } catch (err) {
        if (err.code !== "ENOENT") {
            throw err;
        } else {
            console.log("Upload path does not exist. Skipping cleanup.");
            return;
        }
    }

    console.log(`Reading files. Found ${files.length} files...`);

    for (const file of files) {
        console.log(`Checking ${file}`);
        if (!file.toLowerCase().endsWith('.temp')) {
            continue;
        }

        const fullPath = path.join(uploadPath, file);

        try {
            await fs.unlink(fullPath);
            console.log(`Cleaned up temp file: ${fullPath}`);
        } catch (err) {
            console.warn(`Failed to remove temp file ${fullPath}: ${err.message}`);
        }
    }
}
