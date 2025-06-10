import fs from 'fs/promises';
import path from 'path';

export async function isFileExist(filePath) {
    try {
        await fs.access(filePath);
        return true;
    } catch {
        return false;
    }
}


export function normalizePath(filePath) {
    if (!filePath || typeof filePath !== 'string') {
        throw new Error(`Invalid file path: ${filePath}, could not normalize it.`);
    }
    return path.normalize(path.resolve(filePath)).toLowerCase();
}
