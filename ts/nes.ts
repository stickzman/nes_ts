/// <reference path="rom.ts" />
/// <reference path="ppu.ts" />
class NES {
    private readonly MEM_SIZE = 0x10000;

    private rom: iNESFile;
    private cpu: CPU;
    private ppu: PPU;
    private mainMemory: Uint8Array;

    public static drawFrame: boolean = false;

    constructor(romData: Uint8Array) {
        let canvas = <HTMLCanvasElement>document.getElementById("screen");
        this.mainMemory = new Uint8Array(this.MEM_SIZE);
        this.rom = new iNESFile(romData);
        this.ppu = new PPU(this.mainMemory, canvas);
        this.cpu = new CPU(this.mainMemory, this.ppu);

    }

    public boot() {
        this.ppu.boot();
        this.rom.load(this.mainMemory, this.ppu.mem);
        this.cpu.boot();

        this.step();
    }

    private step() {
        //let prevMS = Date.now();

        NES.drawFrame = false;
        while (!NES.drawFrame) {
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

        this.ppu.ctx.paintFrame();

        //console.log(Date.now() - prevMS);

        window.requestAnimationFrame(this.step.bind(this));
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
