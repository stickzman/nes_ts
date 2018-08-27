class Mapper {

    constructor(protected nes: NES, protected header: iNESFile, protected cpuMem: Uint8Array, protected ppuMem: Uint8Array) { }

    //Allow mapper to watch sections of cpuMem. Return true or false to allow
    //nes to actually write new value to cpuMem
    public notifyWrite(addr: number, byte: number): boolean {
        return true;
    }

    public load() { }
}

//Mapper 0
class NROM extends Mapper {
    private pgrRom : Uint8Array;
    private chrRom: Uint8Array;

    constructor(nes: NES, buff: Uint8Array, header: iNESFile, cpuMem: Uint8Array, ppuMem: Uint8Array) {
        super(nes, header, cpuMem, ppuMem);

        //Start loading memory
        let startLoc = 0x10;
        if (header.trainerPresent) {
            console.log("Trainer Data not yet supported.");
            startLoc += 0x200;
        }
        this.pgrRom = new Uint8Array(
            buff.slice(startLoc, startLoc + 0x4000 * header.pgrPages));
        startLoc += 0x4000 * header.pgrPages;
        this.chrRom = new Uint8Array(
            buff.slice(startLoc, startLoc + 0x2000 * header.chrPages));
    }

    public load() {
        this.cpuMem.set(this.pgrRom, 0x8000);
        if (this.header.pgrPages == 1) {
            this.cpuMem.set(this.pgrRom, 0xC000);
        }
        this.ppuMem.set(this.chrRom, 0);
    }
}

//Mapper 1
class MMC1 extends Mapper {
    private pgrRom: Uint8Array[] = [];
    private chrRom: Uint8Array[] = [];

    //0/1: switch 32 KB at $8000, ignoring low bit of bank number
    //2: fix first bank at $8000 and switch 16 KB bank at $C000
    //3: fix last bank at $C000 and switch 16 KB bank at $8000
    private prgBankMode: number = 0;

    //Switch 4 or 8KB at a time
    private chrRom4KB: boolean = false;
    private shiftReg: number = 1 << 4;

    constructor(nes: NES, buff: Uint8Array, header: iNESFile, cpuMem: Uint8Array, ppuMem: Uint8Array) {
        super(nes, header, cpuMem, ppuMem);
        //Start loading memory
        let startLoc = 0x10;
        if (header.trainerPresent) {
            console.log("Trainer Data not yet supported.");
            startLoc += 0x200;
        }
        for (let i = 0; i < header.pgrPages; i++) {
            this.pgrRom.push(new Uint8Array(buff.slice(startLoc, startLoc + 0x4000)));
            startLoc += 0x4000;
        }
        for (let i = 0; i < header.chrPages * 2; i++) {
            this.chrRom.push(new Uint8Array(buff.slice(startLoc, startLoc + 0x1000)));
            startLoc += 0x1000;
        }
        nes.ppu.singleScreenMirror = true;
    }

    public notifyWrite(addr: number, data: number): boolean {
        if (addr >= 0x8000) {
            if ((data & 0x80) != 0) {
                this.shiftReg = 1 << 4;
                this.prgBankMode = 3;
            } else if (this.shiftReg % 2 == 1) {
                //Shift register is full
                data = ((data & 1) << 4) + (this.shiftReg >> 1);
                data &= 0x1F;
                this.shiftReg = 1 << 4;
                if (addr >= 0xE000) {
                    //PRG Bank
                    switch (this.prgBankMode) {
                        case 0:
                            this.cpuMem.set(this.pgrRom[(data & 0xE)], 0x8000);
                            break;
                        case 1:
                            this.cpuMem.set(this.pgrRom[(data & 0xE)], 0x8000);
                            break;
                        case 2:
                            this.cpuMem.set(this.pgrRom[0], 0x8000);
                            this.cpuMem.set(this.pgrRom[data & 0xF], 0xC000);
                            break;
                        case 3:
                            this.cpuMem.set(this.pgrRom[data & 0xF], 0x8000);
                            this.cpuMem.set(this.pgrRom[this.pgrRom.length-1], 0xC000);
                            break;
                    }
                } else if (addr >= 0xC000) {
                    //CHR Bank 1
                    if (!this.chrRom4KB || this.chrRom.length == 0) return false;
                    this.ppuMem.set(this.chrRom[(data & 0x1F)], 0x1000);
                } else if (addr >= 0xA000) {
                    //CHR Bank 0
                    if (this.chrRom.length == 0) return false;
                    if (this.chrRom4KB) {
                        this.ppuMem.set(this.chrRom[(data & 0x1F)], 0);
                    } else {
                        this.ppuMem.set(this.chrRom[(data & 0x1E)], 0);
                        this.ppuMem.set(this.chrRom[(data & 0x1E) + 1], 0x1000);
                    }
                } else {
                    //Control Register
                    this.chrRom4KB = (data & 0x10) != 0;
                    this.prgBankMode = (data & 0xC) >> 2;
                    if ((data & 1) == 0) {
                        if (!this.nes.ppu.mirrorVertical) {
                            let topRight = new Uint8Array(this.ppuMem.slice(0x2400, 0x2800));
                            let topLeft = new Uint8Array(this.ppuMem.slice(0x2800, 0x2C00));
                            this.ppuMem.set(topRight, 0x2800);
                            this.ppuMem.set(topLeft, 0x2400);
                        }
                        this.nes.ppu.mirrorVertical = true;
                    } else {
                        if (this.nes.ppu.mirrorVertical) {
                            let topRight = new Uint8Array(this.ppuMem.slice(0x2400, 0x2800));
                            let topLeft = new Uint8Array(this.ppuMem.slice(0x2800, 0x2C00));
                            this.ppuMem.set(topRight, 0x2800);
                            this.ppuMem.set(topLeft, 0x2400);
                        }
                        this.nes.ppu.mirrorVertical = false;
                    }
                    this.nes.ppu.singleScreenMirror = (data & (1 << 1)) == 0;
                }
            } else {
                this.shiftReg >>= 1;
                this.shiftReg += (data & 1) << 4;
            }
            return false;
        }
        return true;
    }

    public load() {
        this.cpuMem.set(this.pgrRom[0], 0x8000);
        this.cpuMem.set(this.pgrRom[this.pgrRom.length-1], 0xC000);
        if (this.chrRom.length == 0) return;
        this.ppuMem.set(this.chrRom[0], 0);
        if (this.chrRom.length == 1) return;
        this.ppuMem.set(this.chrRom[1], 0x1000);
    }
}
