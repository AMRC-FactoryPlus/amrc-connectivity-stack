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

export async function waitForFileExist(filePath, retries = 5, delayMs = 500) {
    for (let i = 0; i < retries; i++) {
        if (await isFileExist(filePath)) return true;
        await new Promise(res => setTimeout(res, delayMs));
    }
    return false;
}


export function normalizePath(filePath) {
    if (!filePath || typeof filePath !== 'string') {
        throw new Error(`Invalid file path: ${filePath}, could not normalize it.`);
    }
    return path.normalize(path.resolve(filePath)).toLowerCase();
}


export function sanityCheckFilename(filename){
    const baseFilename = path.basename(filename);

    const isValid = /^[a-zA-Z0-9._-]+$/.test(filename);

    if (!isValid || baseFilename.includes('..') || path.isAbsolute(baseFilename)) {
        return false;
    }
    return true;
}