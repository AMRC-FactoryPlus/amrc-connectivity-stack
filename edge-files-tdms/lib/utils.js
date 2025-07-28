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

    const absolutePath = path.resolve(filePath);
    const dir = path.dirname(absolutePath);
    const file = path.basename(absolutePath).toLowerCase(); // Only lowercasing the filename

    return path.join(dir, file);
}


export function sanityCheckFilename(filename) {
    if (typeof filename !== 'string') return false;

    // Reject path
    if (filename.includes('/') || filename.includes('\\') || filename.includes('..')) return false;

    // Reject names starting with a dot
    if (filename.startsWith('.')) return false;

    // Reject names ending in .temp (case-insensitive)
    if (filename.toLowerCase().endsWith('.temp')) return false;

    // Ensure only safe characters
    if (!/^\w[\w.-]*$/.test(filename)) return false;

    return true;
}