import { decoder, encoder } from "./encoding"

export default class Go {
    private _inst: any
    private _values: any[]
    private _refs: Map<any, any>
    private _callbackShutdown: boolean
    private _resolveCallbackPromise: () => void
    private exited: boolean

    private argv: string[]
    private env: any

    private exit = (code: number) => {
        if (code !== 0) {
            console.warn("exit code:", code)
        }
    }
    private _callbackTimeouts = new Map()
    private _nextCallbackTimeoutID = 1
    private mem = () => {
        // The buffer may change when requesting more memory.
        return new DataView(this._inst.exports.mem.buffer)
    }
    private getInt64 = (addr: number) => {
        const low = this.mem().getUint32(addr + 0, true)
        const high = this.mem().getInt32(addr + 4, true)
        return low + high * 4294967296
    }

    private setInt64 = (addr: number, v: number) => {
        this.mem().setUint32(addr + 0, v, true)
        this.mem().setUint32(addr + 4, Math.floor(v / 4294967296), true)
    }

    private loadValue = (addr: number): any => {
        const f = this.mem().getFloat64(addr, true)
        if (!isNaN(f)) {
            return f
        }
        const id = this.mem().getUint32(addr, true)
        return this._values[id]
    }

    private storeValue = (addr: number, v: any) => {
        const nanHead = 0x7ff80000

        if (typeof v === "number") {
            if (isNaN(v)) {
                this.mem().setUint32(addr + 4, nanHead, true)
                this.mem().setUint32(addr, 0, true)
                return
            }
            this.mem().setFloat64(addr, v, true)
            return
        }

        switch (v) {
            case undefined:
                this.mem().setUint32(addr + 4, nanHead, true)
                this.mem().setUint32(addr, 1, true)
                return
            case null:
                this.mem().setUint32(addr + 4, nanHead, true)
                this.mem().setUint32(addr, 2, true)
                return
            case true:
                this.mem().setUint32(addr + 4, nanHead, true)
                this.mem().setUint32(addr, 3, true)
                return
            case false:
                this.mem().setUint32(addr + 4, nanHead, true)
                this.mem().setUint32(addr, 4, true)
                return
        }

        let ref = this._refs.get(v)
        if (ref === undefined) {
            ref = this._values.length
            this._values.push(v)
            this._refs.set(v, ref)
        }
        let typeFlag = 0
        switch (typeof v) {
            case "string":
                typeFlag = 1
                break
            case "symbol":
                typeFlag = 2
                break
            case "function":
                typeFlag = 3
                break
        }
        this.mem().setUint32(addr + 4, nanHead | typeFlag, true)
        this.mem().setUint32(addr, ref, true)
    }

    private loadSlice = (addr: number) => {
        const array = this.getInt64(addr + 0)
        const len = this.getInt64(addr + 8)
        return new Uint8Array(this._inst.exports.mem.buffer, array, len)
    }

    private loadSliceOfValues = (addr: number) => {
        const array = this.getInt64(addr + 0)
        const len = this.getInt64(addr + 8)
        const a = new Array(len)
        for (let i = 0; i < len; i++) {
            a[i] = this.loadValue(array + i * 8)
        }
        return a
    }

    private loadString = (addr: number) => {
        const saddr = this.getInt64(addr + 0)
        const len = this.getInt64(addr + 8)
        return decoder.decode(new DataView(this._inst.exports.mem.buffer, saddr, len))
    }

    public importObject: any

    public run = async (instance: any) => {
        this._inst = instance
        this._values = [
            // TODO: garbage collection
            NaN,
            undefined,
            null,
            true,
            false,
            global,
            this._inst.exports.mem,
            this,
        ]
        this._refs = new Map()
        this._callbackShutdown = false
        this.exited = false

        const mem = new DataView(this._inst.exports.mem.buffer)

        // Pass command line arguments and environment variables to WebAssembly by writing them to the linear memory.
        let offset = 4096

        const strPtr = (str: string) => {
            let ptr = offset
            new Uint8Array(mem.buffer, offset, str.length + 1).set(encoder.encode(str + "\0"))
            offset += str.length + (8 - (str.length % 8))
            return ptr
        }

        const argc = this.argv.length

        const argvPtrs = []
        this.argv.forEach(arg => {
            argvPtrs.push(strPtr(arg))
        })

        const keys = Object.keys(this.env).sort()
        argvPtrs.push(keys.length)
        keys.forEach(key => {
            argvPtrs.push(strPtr(`${key}=${this.env[key]}`))
        })

        const argv = offset
        argvPtrs.forEach(ptr => {
            mem.setUint32(offset, ptr, true)
            mem.setUint32(offset + 4, 0, true)
            offset += 8
        })

        while (true) {
            const callbackPromise = new Promise(resolve => {
                this._resolveCallbackPromise = () => {
                    if (this.exited) {
                        throw new Error("bad callback: Go program has already exited")
                    }
                    setTimeout(resolve, 0) // make sure it is asynchronous
                }
            })
            this._inst.exports.run(argc, argv)
            if (this.exited) {
                break
            }
            await callbackPromise
        }
    }

    private _makeCallbackHelper = (id: number, pendingCallbacks: any, go: Go) => {
        return function() {
            pendingCallbacks.push({ id: id, args: arguments })
            go._resolveCallbackPromise()
        }
    }

    static _makeEventCallbackHelper(
        preventDefault: Function,
        stopPropagation: Function,
        stopImmediatePropagation: Function,
        fn: Function,
    ) {
        return function(event: Event) {
            if (preventDefault) {
                event.preventDefault()
            }
            if (stopPropagation) {
                event.stopPropagation()
            }
            if (stopImmediatePropagation) {
                event.stopImmediatePropagation()
            }
            fn(event)
        }
    }

    constructor() {
        this.argv = ["js"]
        this.env = {}
        const timeOrigin = Date.now() - performance.now()

        this.importObject = {
            go: {
                // func wasmExit(code int32)
                "runtime.wasmExit": (sp: number) => {
                    const code = this.mem().getInt32(sp + 8, true)
                    this.exited = true
                    delete this._inst
                    delete this._values
                    delete this._refs
                    this.exit(code)
                },

                // func wasmWrite(fd uintptr, p unsafe.Pointer, n int32)
                "runtime.wasmWrite": (sp: number) => {
                    const fd = this.getInt64(sp + 8)
                    const p = this.getInt64(sp + 16)
                    const n = this.mem().getInt32(sp + 24, true)
                    global.fs.writeSync(fd, new Uint8Array(this._inst.exports.mem.buffer, p, n))
                },

                // func nanotime() int64
                "runtime.nanotime": (sp: number) => {
                    this.setInt64(sp + 8, (timeOrigin + performance.now()) * 1000000)
                },

                // func walltime() (sec int64, nsec int32)
                "runtime.walltime": (sp: number) => {
                    const msec = new Date().getTime()
                    this.setInt64(sp + 8, msec / 1000)
                    this.mem().setInt32(sp + 16, (msec % 1000) * 1000000, true)
                },

                // func scheduleCallback(delay int64) int32
                "runtime.scheduleCallback": (sp: number) => {
                    const id = this._nextCallbackTimeoutID
                    this._nextCallbackTimeoutID++
                    this._callbackTimeouts.set(
                        id,
                        setTimeout(
                            () => {
                                this._resolveCallbackPromise()
                            },
                            this.getInt64(sp + 8) + 1, // setTimeout has been seen to fire up to 1 millisecond early
                        ),
                    )
                    this.mem().setInt32(sp + 16, id, true)
                },

                // func clearScheduledCallback(id int32)
                "runtime.clearScheduledCallback": (sp: number) => {
                    const id = this.mem().getInt32(sp + 8, true)
                    clearTimeout(this._callbackTimeouts.get(id))
                    this._callbackTimeouts.delete(id)
                },

                // func getRandomData(r []byte)
                "runtime.getRandomData": (sp: number) => {
                    crypto.getRandomValues(this.loadSlice(sp + 8))
                },

                // func stringVal(value string) ref
                "syscall/js.stringVal": (sp: number) => {
                    this.storeValue(sp + 24, this.loadString(sp + 8))
                },

                // func valueGet(v ref, p string) ref
                "syscall/js.valueGet": (sp: number) => {
                    console.log(this.loadValue(sp + 8))
                    console.log(this.loadString(sp + 16))
                    this.storeValue(sp + 32, Reflect.get(this.loadValue(sp + 8), this.loadString(sp + 16)))
                },

                // func valueSet(v ref, p string, x ref)
                "syscall/js.valueSet": (sp: number) => {
                    Reflect.set(this.loadValue(sp + 8), this.loadString(sp + 16), this.loadValue(sp + 32))
                },

                // func valueIndex(v ref, i int) ref
                "syscall/js.valueIndex": (sp: number) => {
                    this.storeValue(sp + 24, Reflect.get(this.loadValue(sp + 8), this.getInt64(sp + 16)))
                },

                // valueSetIndex(v ref, i int, x ref)
                "syscall/js.valueSetIndex": (sp: number) => {
                    Reflect.set(this.loadValue(sp + 8), this.getInt64(sp + 16), this.loadValue(sp + 24))
                },

                // func valueCall(v ref, m string, args []ref) (ref, bool)
                "syscall/js.valueCall": (sp: number) => {
                    try {
                        const v = this.loadValue(sp + 8)
                        const m = Reflect.get(v, this.loadString(sp + 16))
                        const args = this.loadSliceOfValues(sp + 32)
                        this.storeValue(sp + 56, Reflect.apply(m, v, args))
                        this.mem().setUint8(sp + 64, 1)
                    } catch (err) {
                        this.storeValue(sp + 56, err)
                        this.mem().setUint8(sp + 64, 0)
                    }
                },

                // func valueInvoke(v ref, args []ref) (ref, bool)
                "syscall/js.valueInvoke": (sp: number) => {
                    try {
                        const v = this.loadValue(sp + 8)
                        const args = this.loadSliceOfValues(sp + 16)
                        this.storeValue(sp + 40, Reflect.apply(v, undefined, args))
                        this.mem().setUint8(sp + 48, 1)
                    } catch (err) {
                        this.storeValue(sp + 40, err)
                        this.mem().setUint8(sp + 48, 0)
                    }
                },

                // func valueNew(v ref, args []ref) (ref, bool)
                "syscall/js.valueNew": (sp: number) => {
                    try {
                        const v = this.loadValue(sp + 8)
                        const args = this.loadSliceOfValues(sp + 16)
                        this.storeValue(sp + 40, Reflect.construct(v, args))
                        this.mem().setUint8(sp + 48, 1)
                    } catch (err) {
                        this.storeValue(sp + 40, err)
                        this.mem().setUint8(sp + 48, 0)
                    }
                },

                // func valueLength(v ref) int
                "syscall/js.valueLength": (sp: number) => {
                    this.setInt64(sp + 16, parseInt(this.loadValue(sp + 8).length))
                },

                // valuePrepareString(v ref) (ref, int)
                "syscall/js.valuePrepareString": (sp: number) => {
                    const str = encoder.encode(String(this.loadValue(sp + 8)))
                    this.storeValue(sp + 16, str)
                    this.setInt64(sp + 24, str.length)
                },

                // valueLoadString(v ref, b []byte)
                "syscall/js.valueLoadString": (sp: number) => {
                    const str = this.loadValue(sp + 8)
                    this.loadSlice(sp + 16).set(str)
                },

                // func valueInstanceOf(v ref, t ref) bool
                "syscall/js.valueInstanceOf": (sp: number) => {
                    const n = this.loadValue(sp + 8) instanceof this.loadValue(sp + 16)
                    this.mem().setUint8(sp + 24, +n)
                },

                debug: (value: any) => {
                    console.log(value)
                },
            },
        }
    }
}
