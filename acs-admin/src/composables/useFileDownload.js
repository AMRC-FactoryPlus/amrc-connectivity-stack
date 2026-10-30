import streamSaver from "streamsaver";

export async function useFileDownload(serviceClient, fileName, fileUUID) {
    const readableStream = await serviceClient.Files.get_file_stream(fileUUID);
    if (!readableStream) throw new Error(`File ${fileUUID} not found`);
    const fileStream = streamSaver.createWriteStream(fileName);
    if (window.WritableStream && readableStream.pipeTo) {
        await readableStream.pipeTo(fileStream);
    } else {
        const writer = fileStream.getWriter();
        const reader = readableStream.getReader();

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            await writer.write(value);
        }
        await writer.close();
    }
}