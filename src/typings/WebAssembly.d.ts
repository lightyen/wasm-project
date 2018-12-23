declare namespace WebAssembly {
    class Module {}

    class Instance {
        readonly exports: any
        constructor(module: Module, importObject?: any)
    }

    interface ResultObject {
        module: Module
        instance: Instance
    }

    function instantiate(bufferSource: ArrayBuffer | Uint8Array, importObject?: any): Promise<ResultObject>
    function instantiate(module: Module, importObject?: any): Promise<Instance>
    function instantiateStreaming(resp: Response | Promise<Response>, importObject: any): Promise<ResultObject>
}
