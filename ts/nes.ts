/// <reference path="rom.ts" />
/// <reference path="ppu.ts" />
/// <reference path="input.ts" />
class NES {
    private readonly MEM_SIZE = 0x10000;

    public input: Input;
    public rom: iNESFile;
    public cpu: CPU;
    public ppu: PPU;
    public mainMemory: Uint8Array;

    public drawFrame: boolean = false;
    public lastAnimFrame;

    constructor(romData: Uint8Array, input: Input) {
        this.mainMemory = new Uint8Array(this.MEM_SIZE);
        this.ppu = new PPU(this);
        this.cpu = new CPU(this);
        this.rom = new iNESFile(romData, this);

        if (this.rom.batteryBacked && localStorage.getItem(this.rom.id) !== null) {
            //Parse memory str
            let arr = localStorage.getItem(this.rom.id).split(",");
            let buff = new Uint8Array(0x2000);
            for (let i = 0; i < buff.length; i++) {
                buff[i] = parseInt(arr[i]);
            }
            //Load battery-backed RAM
            this.mainMemory.set(buff, 0x6000);
        }

        //Set up input listeners
        this.input = input;
    }

    public boot() {
        if (this.rom.mapper == undefined) return;
        this.ppu.boot();
        this.rom.mapper.load();
        this.cpu.boot();

        this.step();
    }

    public counter = 0;
    private step() {
        this.drawFrame = false;
        let error = false;
        while (!this.drawFrame) {
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

        this.ppu.paintFrame();

        if (error || this.counter > 500) {
            this.displayMem();
            this.displayPPUMem();
        } else {
            this.lastAnimFrame = window.requestAnimationFrame(this.step.bind(this));
        }
    }

    public read(addr: number): number {
        if (addr >= 0x2000 && addr <= 0x3FFF) {
            let res = this.ppu.readReg(0x2000 + (addr % 8));
            if (res !== undefined) return res;
        }
        if (addr == 0x4016 || addr == 0x4017) {
            return this.input.read(addr);
        }
        return this.mainMemory[addr];
    }

    //Skip setting register values when reading
    public readNoReg(addr: number): number {
        return this.mainMemory[addr];
    }

    public write(addr: number, data: number) {
        if (addr == 0x4016) {
            this.input.setStrobe((data & 1) != 0);
        }
        if (addr >= 0x4020) {
            //Notify mapper of potential register writes. Don't write value
            //if function returns false.
            if (!this.rom.mapper.notifyWrite(addr, data)) return;
        }
        if (addr == 0x4014) {
            this.ppu.writeReg(addr, data);
        }
        if (addr >= 0x2000 && addr <= 0x3FFF) {
            for (let i = 0x2000; i < 0x3FFF; i += 8) {
                this.mainMemory[i + (addr % 8)] = data;
            }
            this.ppu.writeReg(0x2000 + (addr % 8), data);
        }
        if (addr < 0x2000) {
            for (let i = 0; i < 0x2000; i += 0x800) {
                this.mainMemory[i + (addr % 0x800)] = data;
            }
        }
        this.mainMemory[addr] = data;
    }

    //Skip setting register values when writing
    public writeNoReg(addr: number, data: number) {
        if (addr >= 0x2000 && addr <= 0x3FFF) {
            for (let i = 0x2000; i < 0x3FFF; i += 8) {
                this.mainMemory[i + (addr % 8)] = data;
            }
        }
    }

    private displayMem() {
        let str = "";
        for (let i = 0; i < this.mainMemory.length; i++) {
            str += this.mainMemory[i].toString(16).padStart(2, "0").toUpperCase();
        }
        $("#mem").html(str);
    }

    private displayPPUMem() {
        let str = "";
        for (let i = 0; i < this.ppu.mem.length; i++) {
            str += this.ppu.mem[i].toString(16).padStart(2, "0").toUpperCase();
        }
        $("#ppuMem").html(str);
    }

    private displayOAMMem() {
        let str = "";
        for (let i = 0; i < this.ppu.oam.length; i++) {
            str += this.ppu.oam[i].toString(16).padStart(2, "0").toUpperCase();
        }
        $("#ppuMem").html(str);
    }
}



//Initialize NES
let nes;
let input = new Input();

window.onbeforeunload = function () {
    if (nes !== undefined) {
        saveRAM();
    }
}

$(document).ready(function() {
    PPU.canvas = (<HTMLCanvasElement>$("#screen")[0]);
    PPU.updateScale(2);

    $("#scale").change(function() {
        PPU.updateScale(parseInt((<HTMLSelectElement>$("#scale")[0]).value));
    });

    $(document).on("keydown", function (e) {
        if (input.setBtn(e.keyCode, true)) {
            e.preventDefault();
        }
    });
    $(document).on("keyup", function (e) {
        if (input.setBtn(e.keyCode, false)) {
            e.preventDefault();
        }
    });

    input.buildControlTable($("#p1Controls"));
    input.buildControlTable($("#p2Controls"), false);

    $('#file-input').change(function (e:any) {
        init(e.target.files[0]);
    });
});

//Save any battery-backed RAM
function saveRAM() {
    if (!nes.rom.batteryBacked) return;
    localStorage.setItem(nes.rom.id, nes.mainMemory.slice(0x6000, 0x8000).toString());
}

function fileDropHandler(e) {
    e.preventDefault();
    init(e.dataTransfer.files[0]);
}

function init(file) {
    if (!file) {
        return;
    }
    if (nes !== undefined) {
        window.cancelAnimationFrame(nes.lastAnimFrame);
        saveRAM();
    }
    let reader = new FileReader();
    reader.onload = function(e) {
        nes = new NES(new Uint8Array(e.target.result), input);
        nes.boot();
    }
    reader.readAsArrayBuffer(file);
}
