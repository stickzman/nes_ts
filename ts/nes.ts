/// <reference path="rom.ts" />
/// <reference path="ppu.ts" />
/// <reference path="input.ts" />
class NES {
    private readonly MEM_SIZE = 0x10000;
    public static saveWarn: boolean;

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

    constructor(romData: Uint8Array, input: Input) {
        this.mainMemory = new Uint8Array(this.MEM_SIZE);
        this.ppu = new PPU(this);
        this.cpu = new CPU(this);
        this.apu = new APU(this);
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
        this.apu.reset();

        this.step();
    }

    public saveState() {
        if (NES.saveWarn && this.state !== null) {
            APU.masterGain.gain.setTargetAtTime(0, 0, 0.05);
            let cont = confirm("Are you sure?\nSaving now will replace your previous save data.")
            APU.masterGain.gain.setTargetAtTime(APU.masterVol, 0, 0.05);
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
            apu: this.apu.getState()
        };
    }

    public loadState() {
        if (this.state === null) return;
        if (NES.saveWarn) {
            APU.masterGain.gain.setTargetAtTime(0, 0, 0.05);
            let cont = confirm("Are you sure?\nLoading previous save data will erase your current progress.")
            APU.masterGain.gain.setTargetAtTime(APU.masterVol, 0, 0.05);
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
        this.apu.loadState(this.state["apu"]);
    }

    private step() {
        this.drawFrame = false;
        let error = false;
        while (!this.drawFrame) {
            try {
                let cpuCycles = this.cpu.step();
                for (let j = 0; j < cpuCycles * 3; j++) {
                    this.ppu.cycle();
                }
                for (let i = 0; i < cpuCycles; i++) {
                    this.apu.step();
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

    public printDebug() {
        this.print = true;
    }

    public read(addr: number): number {
        if (addr >= 0x2000 && addr <= 0x3FFF) {
            let res = this.ppu.readReg(0x2000 + (addr % 8));
            if (res !== undefined) return res;
        } else if (addr == 0x4016 || addr == 0x4017) {
            return this.input.read(addr);
        } else if (addr == 0x4015) {
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
        } else if (addr >= 0x4000 && addr <= 0x4013) {
            //APU registers
            this.apu.notifyWrite(addr, data);
        } else if (addr == 0x4014) {
            //OAM DMA
            this.ppu.writeReg(addr, data);
        } else if (addr == 0x4015) {
            //APU Status
            this.apu.notifyWrite(addr, data);
        } else if (addr == 0x4016) {
            //Input register
            this.input.setStrobe((data & 1) != 0);
        }  else if (addr == 0x4017) {
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



//Initialize NES
let nes: NES;
let scale: number;
let input: Input = new Input();

window.onbeforeunload = function () {
    if (nes !== undefined) {
        saveRAM();
        nes.storeState();
    }
    sessionStorage.setItem("volume", $("#volume").val().toString());
    sessionStorage.setItem("scale", PPU.scale.toString());
    localStorage.setItem("saveWarn", (NES.saveWarn) ? "1" : "0");
}

var noiseGain;
$(document).ready(function() {
    if (!checkComp()) return;

    //Check little/big endianness of Uint32
    let buff = new ArrayBuffer(8);
    let view32 = new Uint32Array(buff);
    view32[1] = 0x0A0B0C0D;
    PPU.isLittleEndian = true;
    if (buff[4] === 0x0A && buff[5] === 0x0B && buff[6] === 0x0C && buff[7] === 0x0D) {
        PPU.isLittleEndian = false;
    }

    //Set the save state warning indicator
    NES.saveWarn = (localStorage.getItem("saveWarn") == "0") ? false : true;
    $("#warningFlag").prop("checked", NES.saveWarn);

    //Set up APU/Web Audio API
    let a = new AudioContext();
    APU.masterGain = a.createGain();
    APU.masterGain.connect(a.destination);
    let osc = a.createOscillator();
    osc.type = "triangle";
    let g = a.createGain();
    osc.connect(g);
    g.connect(APU.masterGain);
    APU.triangle = new TriangleChannel(osc, g);
    osc = a.createOscillator();
    osc.type = "square";
    g = a.createGain();
    osc.connect(g);
    g.connect(APU.masterGain);
    APU.pulse1 = new PulseChannel(osc, g);
    osc = a.createOscillator();
    osc.type = "square";
    g = a.createGain();
    osc.connect(g);
    g.connect(APU.masterGain);
    APU.pulse2 = new PulseChannel(osc, g, false);
    let o = a.createNoiseSource();
    g = a.createGain();
    o.connect(g);
    g.connect(APU.masterGain);
    APU.noise = new NoiseChannel(o, g);

    //Check for existing volume settings
    if (sessionStorage.getItem("volume") === null) {
        updateVol(0.25); //Set initial volume to 25% (50% of the UI's max)
    } else {
        let vol = parseFloat(sessionStorage.getItem("volume"));
        $("#volume").val(vol);
        updateVol(vol);
    }

    //Create canvas
    PPU.canvas = (<HTMLCanvasElement>$("#screen")[0]);
    //Check for existing scale settings
    if (sessionStorage.getItem("scale") == null) {
        PPU.updateScale(2);
    } else {
        let scale = parseInt(sessionStorage.getItem("scale"));
        PPU.updateScale(scale);
        $("#scale").val(PPU.scale);
    }

    $("#scale").change(function() {
        PPU.updateScale(parseInt((<HTMLSelectElement>$("#scale")[0]).value));
    });
    $("#reset-btn").on("click", function () {
        if (nes !== undefined) nes.reset();
        this.blur();
    });

    //Mute audio when webpage is hidden
    $(document).on('visibilitychange', function() {
        if (document.hidden) {
            APU.masterGain.gain.setTargetAtTime(0, 0, 0.05);
        } else {
            APU.masterGain.gain.setTargetAtTime(APU.masterVol, 0, 0.5);
        }
    });

    //Set up relevant button listeners
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

    //Set up fullscreen listener
    $("#screen").dblclick(function () {
        if (this.webkitRequestFullscreen) {
            this.webkitRequestFullscreen();
        } else if (this.requestFullscreen) {
            this.requestFullscreen();
        } else if (this.mozRequestFullScreen) {
            this.mozRequestFullScreen();
        }
    });

    if (document.onwebkitfullscreenchange !== undefined) {
        document.onwebkitfullscreenchange =  function () {
            checkFullscreen(document.webkitFullscreenElement);
        };
    } else if (document.onfullscreenchange !== undefined) {
        document.onfullscreenchange = function () {
            checkFullscreen(document.fullscreenElement);
        };
    } else if (document.onmozfullscreenchange !== undefined) {
        document.onmozfullscreenchange = function () {
            checkFullscreen(document.mozFullScreenElement);
        };
    }

    //Build the button mapping control table
    input.buildControlTable($("#p1Controls"));
    input.buildControlTable($("#p2Controls"), false);

    //Set up event listener for file picker to launch ROM
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

function checkFullscreen(fullscreenElem) {
    if (fullscreenElem === null) {
        //Exiting fullscreen, return to normal scale
        PPU.updateScale(scale);
    } else {
        //Entering fullscreen, adjust scale and store old value
        scale = PPU.scale;
        let s = Math.min($(window).width()/256, $(window).height()/240);
        PPU.updateScale(Math.floor(s));
    }
}

function init(file) {
    if (!file) {
        return;
    }
    if (nes !== undefined) {
        window.cancelAnimationFrame(nes.lastAnimFrame);
        saveRAM();
        nes.storeState();
    } else {
        //Start the oscillators after the user chooses a file
        //Complies with Chrome's upcoming Web Audio API autostart policy
        APU.noise.osc.start(0);
        APU.triangle.osc.start(0);
        APU.pulse1.osc.start(0);
        APU.pulse2.osc.start(0);
    }
    let reader = new FileReader();
    reader.onload = function(e) {
        nes = new NES(new Uint8Array(e.target.result), input);
        nes.boot();
    }
    reader.readAsArrayBuffer(file);
}
