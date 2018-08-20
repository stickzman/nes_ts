class Mapper {
    constructor(protected header: iNESFile, protected cpuMem: Uint8Array, protected ppuMem: Uint8Array) { }

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
    private trainerData: Uint8Array;

    constructor(buff: Uint8Array, header: iNESFile, cpuMem: Uint8Array, ppuMem: Uint8Array) {
        super(header, cpuMem, ppuMem);

        //Start loading memory
        let startLoc = 0x10;
        if (header.trainerPresent) {
            console.log("Trainer Data not yet supported.");
            this.trainerData = new Uint8Array(
                buff.slice(startLoc, startLoc + 0x200));
            startLoc += 0x200;
        }
        this.pgrRom = new Uint8Array(
            buff.slice(startLoc, startLoc + 0x4000 * header.pgrPages));
        startLoc += 0x4000 * header.pgrPages;
        this.chrRom = new Uint8Array(
            buff.slice(startLoc, startLoc + 0x2000 * header.chrPages));
        startLoc += 0x2000 * header.chrPages;
    }

    public load() {
        this.cpuMem.set(this.pgrRom, 0x8000);
        if (this.header.pgrPages == 1) {
            this.cpuMem.set(this.pgrRom, 0xC000);
        }
        this.ppuMem.set(this.chrRom, 0);
    }
}
