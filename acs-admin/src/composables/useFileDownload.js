import streamSaver from "@/lib/stream-saver.js";
import { pipe_with_stall_timeout } from "@/lib/stream-download.js";

export async function useFileDownload(serviceClient, fileName, fileUUID) {
    const readableStream = await serviceClient.Files.get_file_stream(fileUUID);
    const fileStream = streamSaver.createWriteStream(fileName);
    // Rejects with a message people can act on if the browser never takes the data.
    await pipe_with_stall_timeout(readableStream, fileStream);
}
