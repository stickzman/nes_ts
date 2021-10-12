/// <reference path="helper.ts" />
/// <reference path="rom.ts" />
/// <reference path="ppu.ts" />
/// <reference path="input.ts" />
class NES {
    private readonly MEM_SIZE = 0x10000;
    public static saveWarn: boolean;
    public static limitFPS = false;
    public static maxFrameSkip = 0; // 0 = No frame skip
    private static _framesSkipped = 0;

    public print: boolean = false;
    public input: Input;
    public rom: iNESFile;
    public cpu: CPU;
    public ppu: PPU;
    public apu: APU;
    public mainMemory: Uint8Array;
    public drawFrame: boolean = false;
    public state: object;
    public lastAnimFrame;
    public lastFrameStart = 0;



    constructor(romData: Uint8Array, input: Input) {
        this.mainMemory = new Uint8Array(this.MEM_SIZE);
        this.ppu = new PPU(this);
        this.cpu = new CPU(this);
        if (audioEnabled) this.apu = new APU(this);
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

        //Get save state for this game
        this.state = JSON.parse(localStorage.getItem("save_"+this.rom.id));
        $("#saveState").prop("disabled", false);
        $("#loadState").prop("disabled", this.state === null);

        //Set up input listeners
        this.input = input;
    }

    public static get skipFrame() {
        return (NES._framesSkipped < NES.maxFrameSkip);
    }

    public boot() {
        if (this.rom.mapper == undefined) return;
        this.ppu.boot();
        this.rom.mapper.load();
        this.cpu.boot();

        this.step();
    }

    public reset() {
        window.cancelAnimationFrame(this.lastAnimFrame);
        this.ppu.reset();
        this.cpu.reset();
        if (audioEnabled) this.apu.reset();

        this.step();
    }

    public saveState() {
        if (NES.saveWarn && this.state !== null) {
            if (audioEnabled) APU.masterGain.gain.setTargetAtTime(0, 0, 0.05);
            let cont = confirm("Are you sure?\nSaving now will replace your previous save data.")
            if (audioEnabled) APU.masterGain.gain.setTargetAtTime(APU.masterVol, 0, 0.05);
            if (!cont) return;
        }
        this.state = this.getState();
        $("#loadState").prop("disabled", false);
    }

    public storeState() {
        if (this.state == null) return;
        localStorage.setItem("save_"+this.rom.id, JSON.stringify(this.state));
    }

    public getState(): object {
        return {
            mainMem: this.mainMemory.toString(),
            ppu: this.ppu.getState(),
            cpu: this.cpu.getState(),
            apu: (audioEnabled) ? this.apu.getState() : ""
        };
    }

    public loadState() {
        if (this.state === null) return;
        if (NES.saveWarn) {
            if (audioEnabled) APU.masterGain.gain.setTargetAtTime(0, 0, 0.05);
            let cont = confirm("Are you sure?\nLoading previous save data will erase your current progress.")
            if (audioEnabled) APU.masterGain.gain.setTargetAtTime(APU.masterVol, 0, 0.05);
            if (!cont) return;
        }
        //Parse mainMemory str
        let arr = this.state["mainMem"].split(",");
        let buff = new Uint8Array(this.mainMemory.length);
        for (let i = 0; i < buff.length; i++) {
            buff[i] = parseInt(arr[i]);
        }
        this.mainMemory.set(buff);
        //Load component states
        this.ppu.loadState(this.state["ppu"]);
        this.cpu.loadState(this.state["cpu"]);
        if (audioEnabled) this.apu.loadState(this.state["apu"]);
    }

    private step() {
        if (NES.limitFPS) {
            // Limit framerate to 60 fps
            while (performance.now() - this.lastFrameStart < 16.6) { }
            this.lastFrameStart = performance.now();
        }

        if (NES.maxFrameSkip > 0) {
            // Increase frame skip counter
            this.incFrameSkip();
        }

        this.drawFrame = false;
        let error = false;
        while (!this.drawFrame) {
            try {
                let cpuCycles = this.cpu.step();
                for (let j = 0; j < cpuCycles * 3; j++) {
                    this.ppu.cycle();
                }
                if (audioEnabled) {
                    for (let i = 0; i < cpuCycles; i++) {
                        this.apu.step();
                    }
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

        if (error || this.print) {
            this.displayMem();
            this.displayPPUMem();
            $("#debugDisplay").show();
            this.print = false;
        } else {
            this.lastAnimFrame = window.requestAnimationFrame(this.step.bind(this));
        }
    }

    private incFrameSkip() {
        if (NES._framesSkipped++ >= NES.maxFrameSkip) NES._framesSkipped = 0;
    }

    public printDebug() {
        this.print = true;
    }

    public read(addr: number): number {
        if (addr >= 0x2000 && addr <= 0x3FFF) {
            let res = this.ppu.readReg(0x2000 + (addr % 8));
            if (res !== undefined) return res;
        } else if (addr == 0x4016 || addr == 0x4017) {
            return this.input.read(addr);
        } else if (addr == 0x4015 && audioEnabled) {
            return this.apu.read4015();
        }
        return this.mainMemory[addr];
    }

    //Skip setting register values when reading
    public readNoReg(addr: number): number {
        return this.mainMemory[addr];
    }

    public write(addr: number, data: number) {
        if (addr < 0x2000) {
            //RAM mirroring
            for (let i = 0; i < 0x2000; i += 0x800) {
                this.mainMemory[i + (addr % 0x800)] = data;
            }
        } else if (addr >= 0x2000 && addr <= 0x3FFF) {
            //PPU register mirroring
            for (let i = 0x2000; i < 0x3FFF; i += 8) {
                this.mainMemory[i + (addr % 8)] = data;
            }
            this.ppu.writeReg(0x2000 + (addr % 8), data);
        } else if (addr >= 0x4000 && addr <= 0x4013 && audioEnabled) {
            //APU registers
            this.apu.notifyWrite(addr, data);
        } else if (addr == 0x4014) {
            //OAM DMA
            this.ppu.writeReg(addr, data);
        } else if (addr == 0x4015 && audioEnabled) {
            //APU Status
            this.apu.notifyWrite(addr, data);
        } else if (addr == 0x4016) {
            //Input register
            this.input.setStrobe((data & 1) != 0);
        }  else if (addr == 0x4017 && audioEnabled) {
            //APU Frame Counter
            this.apu.notifyWrite(addr, data);
        } else if (addr >= 0x4020) {
            //Notify mapper of potential register writes. Don't write value
            //if function returns false.
            if (!this.rom.mapper.notifyWrite(addr, data)) return;
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
