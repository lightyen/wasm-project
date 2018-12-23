import Go from "./Go"
import FileStream from "./FileStream"

// ;(() => {
//     if (typeof window !== "undefined") {
//         window.global = window
//     } else if (typeof self !== "undefined") {
//         self.global = self
//     } else {
//         throw new Error("cannot export Go (neither window nor self is defined)")
//     }

//     global.fs = new FileStream()
//     global.Go = new Go()
// })()

// if (!WebAssembly.instantiateStreaming) {
//     // polyfill
//     WebAssembly.instantiateStreaming = async (resp, importObject) => {
//         const source = await (await resp).arrayBuffer()
//         return await WebAssembly.instantiate(source, importObject)
//     }
// }

if (typeof window !== "undefined") {
    window.global = window
} else if (typeof self !== "undefined") {
    self.global = self
} else {
    throw new Error("cannot export Go (neither window nor self is defined)")
}

const go = new Go()
let mod: WebAssembly.Module
let inst: WebAssembly.Instance

WebAssembly.instantiateStreaming(fetch("asm/main.wasm"), go.importObject).then(result => {
    mod = result.module
    inst = result.instance
    const b = document.getElementById("runButton") as HTMLButtonElement
    b.disabled = false
})

global.Go = Go
global.fs = FileStream
global.run = async () => {
    await go.run(inst)
    inst = await WebAssembly.instantiate(mod, go.importObject) // reset instance
}
