/// <reference path="rom.ts" />
/// <reference path="ppu.ts" />
class NES {
    private readonly MEM_PATH = "mem.hex";
    private readonly PPU_MEM_PATH = "ppuMem.hex";
    private readonly MEM_SIZE = 0x10000;
    private fs = require("fs");

    private rom: iNESFile;
    private cpu: CPU;
    private ppu: PPU;
    private mainMemory: Uint8Array;

    private running: boolean = false;

    constructor(nesPath?: string) {
        if (nesPath === undefined) {
            if (this.fs.existsSync(this.MEM_PATH)) {
                this.mainMemory = this.fs.readFileSync(this.MEM_PATH);
            } else {
                this.mainMemory = new Uint8Array(this.MEM_SIZE);
                this.mainMemory.fill(0x02);
            }
        } else {
            this.mainMemory = new Uint8Array(this.MEM_SIZE);
            this.mainMemory.fill(0x02);
        }
        this.rom = new iNESFile(nesPath);
        this.ppu = new PPU(this.mainMemory);
        this.cpu = new CPU(this.mainMemory, this.ppu);
    }

    public boot() {
        this.ppu.boot();
        this.rom.load(this.mainMemory, this.ppu.mem);
        this.cpu.boot();

        this.running = true;
        let i = 0;
        while (i++ < 250000) {
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
        this.fs.writeFileSync(this.PPU_MEM_PATH, Buffer.from(this.ppu.mem));
    }
}


let nes = new NES("../nestest.nes");
nes.boot();
