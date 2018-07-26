/// <reference path="rom.ts" />
/// <reference path="ppu.ts" />
class NES {
    private readonly MEM_SIZE = 0x10000;

    private rom: iNESFile;
    public cpu: CPU;
    private ppu: PPU;
    private mainMemory: Uint8Array;

    public static drawFrame: boolean = false;
    public lastAnimFrame;

    constructor(romData: Uint8Array) {
        let canvas = <HTMLCanvasElement>document.getElementById("screen");
        this.mainMemory = new Uint8Array(this.MEM_SIZE);
        this.rom = new iNESFile(romData);
        this.ppu = new PPU(this, canvas);
        this.cpu = new CPU(this);
    }

    public boot() {
        this.ppu.boot();
        this.rom.load(this.mainMemory, this.ppu.mem);
        this.cpu.boot();

        this.step();
    }

    public counter = 0;
    private step() {
        NES.drawFrame = false;
        let error = false;
        while (!NES.drawFrame) {
            try {
                let cpuCycles = this.cpu.step();
                for (let j = 0; j < cpuCycles * 3; j++) {
                    this.ppu.cycle();
                }
            } catch (e) {
                if (e.name == "Unexpected OpCode") {
                    console.log(e.message);
                    error = true;
                    break;
                }
                throw e;
            }
        }

        this.ppu.ctx.paintFrame();

        if (error || this.counter++ < -1) {
            this.displayMem();
            this.displayPPUMem();
        } else {
            this.lastAnimFrame = window.requestAnimationFrame(this.step.bind(this));
        }
    }

    public read(addr: number): number {
        if (addr >= 0x2000 && addr <= 0x3FFF) {
            //console.log(addr.toString(16));
            this.ppu.readReg(0x2000 + (addr % 8));
        }
        return this.mainMemory[addr];
    }

    public write(addr: number, data: number) {
        if (addr >= 0x2000 && addr <= 0x3FFF) {

            for (let i = 0x2000; i < 0x3FFF; i += 8) {
                this.mainMemory[i + (addr % 8)] = data;
            }
            this.ppu.writeReg(0x2000 + (addr % 8));
            return;
        }
        this.mainMemory[addr] = data;
    }

    private displayMem() {
        let str = "";
        for (let i = 0; i < this.mainMemory.length; i++) {
            str += this.mainMemory[i].toString(16).padStart(2, "0").toUpperCase();
        }
        document.getElementById("mem").innerHTML = str;
    }

    private displayPPUMem() {
        let str = "";
        for (let i = 0; i < this.ppu.mem.length; i++) {
            str += this.ppu.mem[i].toString(16).padStart(2, "0").toUpperCase();
        }
        document.getElementById("ppuMem").innerHTML = str;
    }
}


let nes;

document.getElementById('file-input')
  .addEventListener('change', init, false);

function init(e) {
    if (nes !== undefined) {
        window.cancelAnimationFrame(nes.lastAnimFrame);
    }
    let file = e.target.files[0];
    if (!file) {
        return;
    }
    let reader = new FileReader();
    reader.onload = function(e) {
        nes = new NES(new Uint8Array(e.target.result));
        nes.boot();
    }
    reader.readAsArrayBuffer(file);
}
