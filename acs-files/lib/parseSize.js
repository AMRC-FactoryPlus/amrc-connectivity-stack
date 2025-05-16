export function parseSize(sizeStr) {
    if (typeof sizeStr !== 'string') return 0;

    const match = sizeStr.trim().toUpperCase().match(/^(\d+(?:\.\d+)?)(KB|MB|GB|B)?$/);
    if (!match) throw new Error(`Invalid size format: ${sizeStr}`);

    const value = parseFloat(match[1]);
    const unit = match[2] || 'B';

    const unitMap = {
        B: 1,
        KB: 1024,
        MB: 1024 ** 2,
        GB: 1024 ** 3,
    };

    return value * unitMap[unit];
}