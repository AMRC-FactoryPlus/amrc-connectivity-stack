import fs from 'fs/promises';

export async function isFileExist(filePath) {
    try {
        await fs.access(filePath);
        return true;
    } catch {
        return false;
    }
}