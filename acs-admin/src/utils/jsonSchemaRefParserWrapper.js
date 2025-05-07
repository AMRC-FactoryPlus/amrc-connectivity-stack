export async function dereference(...args) {
    const mod = await import('@apidevtools/json-schema-ref-parser');
    const Parser = mod.default || mod;
    return Parser.dereference(...args);
}