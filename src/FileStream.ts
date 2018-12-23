import { decoder } from "./encoding"

export default class FileStream {
    public static outputBuf = ""
    public static constants: any = { O_WRONLY: -1, O_RDWR: -1, O_CREAT: -1, O_TRUNC: -1, O_APPEND: -1, O_EXCL: -1 } // unused
    public static writeSync = (fd: number, buf: Uint8Array): number => {
        FileStream.outputBuf += decoder.decode(buf)
        const nl = FileStream.outputBuf.lastIndexOf("\n")
        if (nl != -1) {
            console.log(FileStream.outputBuf.substr(0, nl))
            FileStream.outputBuf = FileStream.outputBuf.substr(nl + 1)
        }
        return buf.length
    }

    public static openSync = (path: string, flags: any, mode: any) => {
        const err = new Error("not implemented")
        err.message = "ENOSYS"
        throw err
    }
}
