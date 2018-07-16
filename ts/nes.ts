/// <reference path="rom.ts" />
class NES {
    private readonly MEM_PATH = "mem.hex";
    private readonly MEM_SIZE = 0x10000;
    private fs = require("fs");

    private rom: iNESFile;
    private cpu: CPU;
    private mainMemory: Uint8Array;

    private running: boolean = false;

    constructor(nesPath?: string) {
        if (nesPath === undefined) {
            if (this.fs.existsSync(this.MEM_PATH)) {
                this.mainMemory = this.fs.readFileSync(this.MEM_PATH);
            } else {
                this.mainMemory = new Uint8Array(this.MEM_SIZE);
                this.mainMemory.fill(0xFF);
            }
        } else {
            this.mainMemory = new Uint8Array(this.MEM_SIZE);
            this.mainMemory.fill(0xFF);
        }
        this.rom = new iNESFile(nesPath);
        this.cpu = new CPU(this.mainMemory);
    }

    public boot() {
        this.rom.load(this.mainMemory);
        this.cpu.boot();
        this.cpu.PC = 0xC000;

        this.running = true;
        while (this.running) {
            try {
                this.cpu.step();
            } catch (e) {
                if (e.name == "Unexpected OpCode") {
                    console.log(e.message);
                    break;
                }
                throw e;
            }
        }

        this.fs.writeFileSync(this.MEM_PATH, Buffer.from(this.mainMemory));
    }
}


let nes = new NES("../nestest.nes");
nes.boot();
