/// <reference path="rom.ts" />
/// <reference path="ppu.ts" />
class NES {
    private readonly MEM_SIZE = 0x10000;

    private rom: iNESFile;
    private cpu: CPU;
    private ppu: PPU;
    private mainMemory: Uint8Array;

    private running: boolean = false;

    constructor(romData: Uint8Array) {
        let canvas = <HTMLCanvasElement>document.getElementById("screen");
        let ctx = canvas.getContext("2d");
        this.mainMemory = new Uint8Array(this.MEM_SIZE);
        this.rom = new iNESFile(romData);
        this.ppu = new PPU(this.mainMemory, ctx);
        this.cpu = new CPU(this.mainMemory, this.ppu);

    }

    public boot() {
        this.ppu.boot();
        this.rom.load(this.mainMemory, this.ppu.mem);
        this.cpu.boot();

        this.running = true;
        let i = 0;
        while (i++ < 100000) {
            try {
                let cpuCycles = this.cpu.step();
                for (let j = 0; j < cpuCycles * 3; j++) {
                    this.ppu.cycle();
                }
            } catch (e) {
                if (e.name == "Unexpected OpCode") {
                    console.log(e.message);
                    break;
                }
                throw e;
            }
        }

        this.displayMem();
        this.displayPPUMem();
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
